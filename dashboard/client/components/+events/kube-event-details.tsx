import "./kube-event-details.scss";

import React from "react";
import { observer } from "mobx-react";
import { Trans } from "@lingui/macro";
import { KubeObject } from "../../api/kube-object";
import { DrawerItem, DrawerTitle } from "../drawer";
import { cssNames } from "../../utils";
import { Icon } from "../icon";
import { eventStore } from "./event.store";

interface Props {
  object: KubeObject;
}

@observer
export class KubeEventDetails extends React.Component<Props> {
  async componentDidMount() {
    eventStore.loadAll();
  }

  render() {
    const { object } = this.props;
    const events = eventStore.getEventsByObject(object);
    if (!events.length) {
      return null;
    }
    return (
      <>
        <DrawerTitle className="flex gaps align-center">
          <Icon material="access_time"/>
          <span><Trans>Events</Trans></span>
        </DrawerTitle>
        <div className="KubeEventDetails">
          {events.map(evt => {
            const { message, count, lastTimestamp, involvedObject } = evt
            return (
              <div className="event" key={evt.getId()}>
                <div className={cssNames("title", { warning: evt.isWarning() })}>
                  {message}
                </div>
                <DrawerItem name={<Trans>Source</Trans>}>
                  {evt.getSource()}
                </DrawerItem>
                <DrawerItem name={<Trans>Count</Trans>}>
                  {count}
                </DrawerItem>
                <DrawerItem name={<Trans>Sub-object</Trans>}>
                  {involvedObject.fieldPath}
                </DrawerItem>
                <DrawerItem name={<Trans>Last seen</Trans>}>
                  {lastTimestamp}
                </DrawerItem>
              </div>
            )
          })}
        </div>
      </>
    )
  }
}
