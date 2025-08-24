import { asBoolean } from "@f9g/core";
import React, { PropsWithChildren } from "react";
import { FeatureFlagContext } from "./Context";
import useConfig from "./useConfig";

export function withFeatureFlag<P>(
  ffKey: string
) {
  return (
    FallbackComponent: React.ComponentType<P>
  ) => (
    Component: React.ComponentType<P>
  ) => {
    const HOC: React.FC<P> = (props) => {
      const { adapter, isInit } = React.useContext(FeatureFlagContext) ?? {};
      const value = useConfig(ffKey, asBoolean);

      if (!adapter) {
        throw new Error("FeatureFlagProvider is missing");
      }

      const shouldShowNewComponent = Boolean(isInit && value);

      return shouldShowNewComponent
        ? <Component {...props} />
        : <FallbackComponent {...props} />;
    };

    HOC.displayName = `withFeatureFlag(${Component.displayName || Component.name || 'Component'})`;

    return HOC;
  };
}
