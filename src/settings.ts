import MyPlugin from "main";
import { App, PluginSettingTab, Setting } from "obsidian";

const SETTINGS_KEY = "settings";
export class PDFJuicerSettings {
  grabMouseSensitivity: number = 1;
  plugin: MyPlugin;

  private constructor() {}
  static async load(plugin: MyPlugin): Promise<PDFJuicerSettings> {
    const data = (await plugin.loadData()) as any;
    const settingsData = data?.[SETTINGS_KEY] ?? {};
    const settings = new PDFJuicerSettings();
    settings.grabMouseSensitivity =
      settingsData.grabMouseSensitivity ?? settings.grabMouseSensitivity;
    settings.plugin = plugin;
    return settings;
  }

  async save(): Promise<void> {
    const entireData = (await this.plugin.loadData()) ?? {};
    const settingsData = {
      grabMouseSensitivity: this.grabMouseSensitivity,
    };
    await this.plugin.saveData({ ...entireData, [SETTINGS_KEY]: settingsData });
  }
}

export class SampleSettingsTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName("Grab Mouse Sensitivity").addText((t) => {
      t.inputEl.type = "number";
      t.setValue(this.plugin.settings.grabMouseSensitivity.toString());
      t.onChange(async (v) => {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) {
          this.plugin.settings.grabMouseSensitivity = num;
          await this.plugin.settings.save();
        }
      });
    });
  }
}
