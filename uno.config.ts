// Prevent UnoCSS preset-icons from misdetecting IDE terminal as VS Code extension host
delete process.env.VSCODE_CWD;

import {
  defineConfig,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";
import { presetAntdColors } from "./src/unocss/presetAntdColors";

export default defineConfig({
  presets: [presetWind4(), presetAntdColors(), presetIcons()],
  transformers: [
    transformerVariantGroup(),
    transformerDirectives({
      applyVariable: ["--uno"],
    }),
  ],
});
