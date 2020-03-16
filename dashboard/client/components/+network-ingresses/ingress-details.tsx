import "./ingress-details.scss";

import * as React from "react";
import { disposeOnUnmount, observer } from "mobx-react";
import { reaction } from "mobx";
import { Trans } from "@lingui/macro";
import { DrawerItem, DrawerTitle } from "../drawer";
import { Ingress, ingressApi } from "../../api/endpoints";
import { Table, TableCell, TableHead, TableRow } from "../table";
import { KubeEventDetails } from "../+events/kube-event-details";
import { ingressStore } from "./ingress.store";
import { ResourceMetrics } from "../resource-metrics";
import { KubeObjectDetailsProps } from "../kube-object";
import { IngressCharts } from "./ingress-charts";
import { apiManager } from "../../api/api-manager";
import { KubeObjectMeta } from "../kube-object/kube-object-meta";

interface Props extends KubeObjectDetailsProps<Ingress> {
}

@observer
export class IngressDetails extends React.Component<Props> {
  @disposeOnUnmount
  clean = reaction(() => this.props.object, () => {
    ingressStore.reset();
  });

  componentWillUnmount() {
    ingressStore.reset();
  }

  renderPaths(ingress: Ingress) {
    const { spec: { rules } } = ingress
    if (!rules || !rules.length) return null
    return rules.map((rule, index) => {
      return (
        <div className="rules" key={index}>
          {rule.host && (
            <div className="host-title">
              <Trans>Host: {rule.host}</Trans>
            </div>
          )}
          {rule.http && (
            <Table className="paths">
              <TableHead>
                <TableCell className="path"><Trans>Path</Trans></TableCell>
                <TableCell className="backends"><Trans>Backends</Trans></TableCell>
              </TableHead>
              {
                rule.http.paths.map((path, index) => {
                  const backend = `${path.backend.serviceName}:${path.backend.servicePort}`
                  return (
                    <TableRow key={index}>
                      <TableCell className="path">{path.path || ""}</TableCell>
                      <TableCell className="backends">
                        <p key={backend}>{backend}</p>
                      </TableCell>
                    </TableRow>
                  )
                })
              }
            </Table>
          )}
        </div>
      )
    })
  }

  render() {
    const { object: ingress } = this.props;
    if (!ingress) {
      return null;
    }
    const { spec } = ingress;
    const { metrics } = ingressStore;
    const metricTabs = [
      <Trans>Network</Trans>,
      <Trans>Duration</Trans>,
    ];
    return (
      <div className="IngressDetails">
        <ResourceMetrics
          loader={() => ingressStore.loadMetrics(ingress)}
          tabs={metricTabs} object={ingress} params={{ metrics }}
        >
          <IngressCharts/>
        </ResourceMetrics>
        <KubeObjectMeta object={ingress}/>
        <DrawerItem name={<Trans>Ports</Trans>}>
          {ingress.getPorts()}
        </DrawerItem>
        {spec.tls &&
        <DrawerItem name={<Trans>TLS</Trans>}>
          {spec.tls.map((tls, index) => <p key={index}>{tls.secretName}</p>)}
        </DrawerItem>
        }
        {spec.backend && spec.backend.serviceName && spec.backend.servicePort &&
        <DrawerItem name={<Trans>Service</Trans>}>
          {spec.backend.serviceName}:{spec.backend.servicePort}
        </DrawerItem>
        }
        <DrawerTitle title={<Trans>Rules</Trans>}/>
        {this.renderPaths(ingress)}

        <KubeEventDetails object={ingress}/>
      </div>
    )
  }
}

apiManager.registerViews(ingressApi, {
  Details: IngressDetails,
})