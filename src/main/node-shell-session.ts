import * as WebSocket from "ws"
import * as pty from "node-pty"
import { ShellSession } from "./shell-session";
import { v4 as uuid } from "uuid"
import * as k8s from "@kubernetes/client-node"
import logger from "./logger";
import { KubeConfig, V1Pod } from "@kubernetes/client-node";
import { tracker } from "./tracker"
import { Cluster, ClusterPreferences } from "./cluster"

export class NodeShellSession extends ShellSession {
  protected nodeName: string;
  protected podId: string
  protected kc: KubeConfig

  constructor(socket: WebSocket, pathToKubeconfig: string, cluster: Cluster, nodeName: string) {
    super(socket, pathToKubeconfig, cluster)
    this.nodeName = nodeName
    this.podId = `node-shell-${uuid()}`
    this.kc = cluster.contextHandler.kc
  }

  public async open() {
    const shell = await this.kubectl.kubectlPath()
    let args = []
    if (this.createNodeShellPod(this.podId, this.nodeName)) {
      await this.waitForRunningPod(this.podId).catch((error) => {
        this.exit(1001)
      })
    }
    args = ["exec", "-i", "-t", "-n", "kube-system", this.podId, "--", "sh", "-c", "((clear && bash) || (clear && ash) || (clear && sh))"]

    const shellEnv = this.getShellEnv()
    this.shellProcess = pty.spawn(shell, args, {
      cols: 80,
      cwd: this.cwd() || shellEnv["HOME"],
      env: shellEnv,
      name: "xterm-256color",
      rows: 30,
    });
    this.pipeStdout()
    this.pipeStdin()
    this.closeWebsocketOnProcessExit()
    this.exitProcessOnWebsocketClose()

    tracker.event("node-shell", "open")
  }

  protected exit(code = 1000) {
    if (this.podId) {
      this.deleteNodeShellPod()
    }
    super.exit(code)
  }

  protected async createNodeShellPod(podId: string, nodeName: string) {
    const kc = this.getKubeConfig();
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const pod = {
      metadata: {
        name: podId,
        namespace: "kube-system"
      },
      spec: {
        restartPolicy: "Never",
        terminationGracePeriodSeconds: 0,
        hostPID: true,
        hostIPC: true,
        hostNetwork: true,
        tolerations: [{
          operator: "Exists"
        }],
        containers: [{
          name: "shell",
          image: "docker.io/alpine:3.9",
          securityContext: {
            privileged: true,
          },
          command: ["nsenter"],
          args: ["-t", "1", "-m", "-u", "-i", "-n", "sleep", "14000"]
        }],
        nodeSelector: {
          "kubernetes.io/hostname": nodeName
        }
      }
    } as k8s.V1Pod;
    await k8sApi.createNamespacedPod("kube-system", pod).catch((error) => {
      logger.error(error)
      return false
    })
    return true
  }

  protected getKubeConfig() {
    if (this.kc) {
      return this.kc
    }
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromFile(this.kubeconfigPath)
    return this.kc
  }

  protected waitForRunningPod(podId: string) {
    return new Promise<boolean>((resolve, reject) => {
      const kc = this.getKubeConfig();
      const watch = new k8s.Watch(kc);

      const req = watch.watch(`/api/v1/namespaces/kube-system/pods`, {},
      // callback is called for each received object.
        (_type, obj) => {
          if (obj.metadata.name == podId && obj.status.phase === "Running") {
            resolve(true)
          }
        },
        // done callback is called if the watch terminates normally
        (err) => {
          logger.error(err)
          reject(false)
        }
      );
      setTimeout(() => { req.abort(); reject(false); }, 120 * 1000);
    })
  }
  protected deleteNodeShellPod() {
    const kc = this.getKubeConfig();
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    k8sApi.deleteNamespacedPod(this.podId, "kube-system")
  }
}

export async function open(socket: WebSocket, pathToKubeconfig: string, cluster: Cluster, nodeName?: string): Promise<ShellSession> {
  return new Promise(async(resolve, reject) => {
    let shell = null
    if (nodeName) {
      shell = new NodeShellSession(socket, pathToKubeconfig, cluster, nodeName)
    }
    else {
      shell = new ShellSession(socket, pathToKubeconfig, cluster)
    }
    shell.open()
    resolve(shell)
  })
}
