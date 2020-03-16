import "./roles.scss"

import * as React from "react";
import { observer } from "mobx-react";
import { Trans } from "@lingui/macro";
import { RouteComponentProps } from "react-router";
import { IRolesRouteParams } from "../+user-management/user-management.routes";
import { KubeObjectMenu, KubeObjectMenuProps } from "../kube-object/kube-object-menu";
import { rolesStore } from "./roles.store";
import { clusterRoleApi, Role, roleApi } from "../../api/endpoints";
import { KubeObjectListLayout } from "../kube-object";
import { AddRoleDialog } from "./add-role-dialog";
import { Icon } from "../icon";
import { KubeObject } from "../../api/kube-object";
import { apiManager } from "../../api/api-manager";

enum sortBy {
  name = "name",
  namespace = "namespace",
  age = "age",
}

interface Props extends RouteComponentProps<IRolesRouteParams> {
}

@observer
export class Roles extends React.Component<Props> {
  render() {
    return (
      <>
        <KubeObjectListLayout
          className="Roles"
          store={rolesStore}
          sortingCallbacks={{
            [sortBy.name]: (role: Role) => role.getName(),
            [sortBy.namespace]: (role: Role) => role.getNs(),
            [sortBy.age]: (role: Role) => role.getAge(false),
          }}
          searchFilters={[
            (role: Role) => role.getSearchFields(),
          ]}
          filterItems={[
            (items: Role[]) => items.filter(KubeObject.isNonSystem),
          ]}
          renderHeaderTitle={<Trans>Roles</Trans>}
          customizeHeader={({ info }) => ({
            info: (
              <>
                {info}
                <Icon
                  small
                  material="help_outline"
                  className="help-icon"
                  tooltip={<Trans>Excluded items with "system:" prefix</Trans>}
                />
              </>
            )
          })}
          renderTableHeader={[
            { title: <Trans>Name</Trans>, className: "name", sortBy: sortBy.name },
            { title: <Trans>Namespace</Trans>, className: "namespace", sortBy: sortBy.namespace },
            { title: <Trans>Age</Trans>, className: "age", sortBy: sortBy.age },
          ]}
          renderTableContents={(role: Role) => [
            role.getName(),
            role.getNs() || "-",
            role.getAge(),
          ]}
          renderItemMenu={(item: Role) => {
            return <RoleMenu object={item}/>
          }}
          addRemoveButtons={{
            onAdd: () => AddRoleDialog.open(),
            addTooltip: <Trans>Create new Role</Trans>,
          }}
        />
        <AddRoleDialog/>
      </>
    )
  }
}

export function RoleMenu(props: KubeObjectMenuProps<Role>) {
  return (
    <KubeObjectMenu {...props}/>
  )
}

apiManager.registerViews([roleApi, clusterRoleApi], {
  Menu: RoleMenu,
});
