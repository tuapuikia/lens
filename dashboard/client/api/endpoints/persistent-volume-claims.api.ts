import { KubeObject } from "../kube-object";
import { autobind } from "../../utils";
import { IMetrics, metricsApi } from "./metrics.api";
import { Pod } from "./pods.api";
import { KubeApi } from "../kube-api";

export class PersistentVolumeClaimsApi extends KubeApi<PersistentVolumeClaim> {
  getMetrics(pvcName: string, namespace: string): Promise<IPvcMetrics> {
    const diskUsage = `sum(kubelet_volume_stats_used_bytes{persistentvolumeclaim="${pvcName}"}) by (persistentvolumeclaim, namespace)`;
    const diskCapacity = `sum(kubelet_volume_stats_capacity_bytes{persistentvolumeclaim="${pvcName}"}) by (persistentvolumeclaim, namespace)`;

    return metricsApi.getMetrics({
      diskUsage,
      diskCapacity
    }, {
      namespace
    });
  }
}

export interface IPvcMetrics<T = IMetrics> {
  [key: string]: T;
  diskUsage: T;
  diskCapacity: T;
}

@autobind()
export class PersistentVolumeClaim extends KubeObject {
  static kind = "PersistentVolumeClaim"

  spec: {
    accessModes: string[];
    storageClassName: string;
    selector: {
      matchLabels: {
        release: string;
      };
      matchExpressions: {
        key: string; // environment,
        operator: string; // In,
        values: string[]; // [dev]
      }[];
    };
    resources: {
      requests: {
        storage: string; // 8Gi
      };
    };
  }
  status: {
    phase: string; // Pending
  }

  getPods(allPods: Pod[]): Pod[] {
    const pods = allPods.filter(pod => pod.getNs() === this.getNs())
    return pods.filter(pod => {
      return pod.getVolumes().filter(volume =>
        volume.persistentVolumeClaim &&
        volume.persistentVolumeClaim.claimName === this.getName()
      ).length > 0
    })
  }

  getStorage(): string {
    if (!this.spec.resources || !this.spec.resources.requests) return "-";
    return this.spec.resources.requests.storage;
  }

  getMatchLabels(): string[] {
    if (!this.spec.selector || !this.spec.selector.matchLabels) return [];
    return Object.entries(this.spec.selector.matchLabels)
      .map(([name, val]) => `${name}:${val}`);
  }

  getMatchExpressions() {
    if (!this.spec.selector || !this.spec.selector.matchExpressions) return [];
    return this.spec.selector.matchExpressions;
  }

  getStatus(): string {
    if (this.status) return this.status.phase;
    return "-"
  }
}

export const pvcApi = new PersistentVolumeClaimsApi({
  kind: PersistentVolumeClaim.kind,
  apiBase: "/api/v1/persistentvolumeclaims",
  isNamespaced: true,
  objectConstructor: PersistentVolumeClaim,
});
