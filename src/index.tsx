//import { ExtensionContext } from "@foxglove/studio";
//
//import { initExamplePanel } from "./H264Panel";
//
//export function activate(extensionContext: ExtensionContext): void {
//  extensionContext.registerPanel({
//    name: "H264 Playback",
//    initPanel: initExamplePanel,
//  });
//}

import { StrictMode, useMemo } from "react";
import ReactDOM from "react-dom";

import { useCrash } from "@foxglove/hooks";
import { PanelExtensionContext } from "@foxglove/studio";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import Panel from "@foxglove/studio-base/components/Panel";
import { PanelExtensionAdapter } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { initExamplePanel } from "./H264Panel";
import { H264State as Config } from "./Settings";

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

function H264PanelAdapter(props: Props) {
  const boundInitPanel = useMemo(() => initExamplePanel.bind(undefined),[]);

  return (
    <PanelExtensionAdapter
      config={props.config}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
    />
  );
}

H264PanelAdapter.panelType = "H264Playback";
const defaultConfig: Config = {
  data: {
  topic: ""
  }
};
H264PanelAdapter.defaultConfig = defaultConfig;

export default Panel(H264PanelAdapter);
