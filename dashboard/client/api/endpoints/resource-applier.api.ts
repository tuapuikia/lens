import jsYaml from "js-yaml"
import { KubeObject } from "../kube-object";
import { KubeJsonApiData } from "../kube-json-api";
import { apiKubeResourceApplier } from "../index";
import { apiManager } from "../api-manager";

export const resourceApplierApi = {
  annotations: [
    "kubectl.kubernetes.io/last-applied-configuration"
  ],

  async update<D extends KubeObject>(resource: object | string): Promise<D> {
    if (typeof resource === "string") {
      resource = jsYaml.safeLoad(resource);
    }
    return apiKubeResourceApplier
      .post<KubeJsonApiData[]>("/stack", { data: resource })
      .then(data => {
        const items = data.map(obj => {
          const api = apiManager.getApi(obj.metadata.selfLink);
          return new api.objectConstructor(obj);
        });
        return items.length === 1 ? items[0] : items;
      });
  }
};
