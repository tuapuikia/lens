// Kubernetes watch-api consumer

import { computed, observable, reaction } from "mobx";
import { stringify } from "querystring"
import { autobind, EventEmitter, interval } from "../utils";
import { KubeJsonApiData } from "./kube-json-api";
import { IKubeWatchEvent, IKubeWatchRouteEvent, IKubeWatchRouteQuery } from "../../server/common/kubewatch";
import { KubeObjectStore } from "../kube-object.store";
import { KubeApi } from "./kube-api";
import { configStore } from "../config.store";
import { apiManager } from "./api-manager";

export {
  IKubeWatchEvent
}

@autobind()
export class KubeWatchApi {
  protected evtSource: EventSource;
  protected onData = new EventEmitter<[IKubeWatchEvent]>();
  protected apiUrl = configStore.apiPrefix.BASE + "/watch";
  protected subscribers = observable.map<KubeApi, number>();
  protected reconnectInterval = interval(60 * 5, this.reconnect); // background reconnect every 5min
  protected reconnectTimeoutMs = 5000;
  protected maxReconnectsOnError = 10;
  protected reconnectAttempts = this.maxReconnectsOnError;

  constructor() {
    reaction(() => this.activeApis, () => this.connect(), {
      fireImmediately: true,
      delay: 500,
    });
  }

  @computed get activeApis() {
    return Array.from(this.subscribers.keys());
  }

  getSubscribersCount(api: KubeApi) {
    return this.subscribers.get(api) || 0;
  }

  subscribe(...apis: KubeApi[]) {
    apis.forEach(api => {
      this.subscribers.set(api, this.getSubscribersCount(api) + 1);
    });
    return () => apis.forEach(api => {
      const count = this.getSubscribersCount(api) - 1;
      if (count <= 0) this.subscribers.delete(api);
      else this.subscribers.set(api, count);
    });
  }

  protected getQuery(): Partial<IKubeWatchRouteQuery> {
    const { isClusterAdmin, allowedNamespaces } = configStore;
    return {
      api: this.activeApis.map(api => {
        if (isClusterAdmin) return api.getWatchUrl();
        return allowedNamespaces.map(namespace => api.getWatchUrl(namespace))
      }).flat()
    }
  }

  // todo: maybe switch to websocket to avoid often reconnects
  @autobind()
  protected connect() {
    if (this.evtSource) this.disconnect(); // close previous connection
    if (!this.activeApis.length) {
      return;
    }
    const query = this.getQuery();
    const apiUrl = this.apiUrl + "?" + stringify(query);
    this.evtSource = new EventSource(apiUrl);
    this.evtSource.onmessage = this.onMessage;
    this.evtSource.onerror = this.onError;
    this.writeLog("CONNECTING", query.api);
  }

  reconnect() {
    if (!this.evtSource || this.evtSource.readyState !== EventSource.OPEN) {
      this.reconnectAttempts = this.maxReconnectsOnError;
      this.connect();
    }
  }

  protected disconnect() {
    if (!this.evtSource) return;
    this.evtSource.close();
    this.evtSource.onmessage = null;
    this.evtSource = null;
  }

  protected onMessage(evt: MessageEvent) {
    if (!evt.data) return;
    const data = JSON.parse(evt.data);
    if ((data as IKubeWatchEvent).object) {
      this.onData.emit(data);
    }
    else {
      this.onRouteEvent(data);
    }
  }

  protected async onRouteEvent({ type, url }: IKubeWatchRouteEvent) {
    if (type === "STREAM_END") {
      this.disconnect();
      const { apiBase, namespace } = KubeApi.parseApi(url);
      const api = apiManager.getApi(apiBase);
      if (api) {
        await api.refreshResourceVersion({ namespace });
        this.reconnect();
      }
    }
  }

  protected onError(evt: MessageEvent) {
    const { reconnectAttempts: attemptsRemain, reconnectTimeoutMs } = this;
    if (evt.eventPhase === EventSource.CLOSED) {
      if (attemptsRemain > 0) {
        this.reconnectAttempts--;
        setTimeout(() => this.connect(), reconnectTimeoutMs);
      }
    }
  }

  protected writeLog(...data: any[]) {
    if (configStore.isDevelopment) {
      console.log('%cKUBE-WATCH-API:', `font-weight: bold`, ...data);
    }
  }

  addListener(store: KubeObjectStore, callback: (evt: IKubeWatchEvent) => void) {
    const listener = (evt: IKubeWatchEvent<KubeJsonApiData>) => {
      const { selfLink, namespace, resourceVersion } = evt.object.metadata;
      const api = apiManager.getApi(selfLink);
      api.setResourceVersion(namespace, resourceVersion);
      api.setResourceVersion("", resourceVersion);
      if (store == apiManager.getStore(api)) {
        callback(evt);
      }
    };
    this.onData.addListener(listener);
    return () => this.onData.removeListener(listener);
  }

  reset() {
    this.subscribers.clear();
  }
}

export const kubeWatchApi = new KubeWatchApi();
