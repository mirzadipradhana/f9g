import React, { PropsWithChildren } from "react";
import { FeatureFlagContext } from "./Context";
import useConfig from "~useConfig";
import { asBoolean } from "@f9g/core";

interface WithFeatureFlagComponentProps {
  fallback: React.ReactNode;
  name: string;
}

export const WithFeatureFlagComponent: React.FC<
  PropsWithChildren<WithFeatureFlagComponentProps>
> = ({ fallback, name, children }) => {
  const { adapter, isInit } = React.useContext(FeatureFlagContext) ?? {};
  const value = useConfig(name, asBoolean);

  if (!adapter) {
    throw new Error("FeatureFlag Provider is missing");
  }

  if (!isInit && value) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
