import { App, PluginSettingTab, Setting } from 'obsidian';
import { SwitcherPlusSettings } from 'src/settings';
import type SwitcherPlusPlugin from '../main';

export class SwitcherPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: SwitcherPlusPlugin,
    private settings: SwitcherPlusSettings,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, settings } = this;

    containerEl.empty();
    SwitcherPlusSettingTab.setAlwaysNewPaneForSymbols(containerEl, settings);
    SwitcherPlusSettingTab.setSymbolsInLineOrder(containerEl, settings);
  }

  static setAlwaysNewPaneForSymbols(
    containerEl: HTMLElement,
    settings: SwitcherPlusSettings,
  ): void {
    new Setting(containerEl)
      .setName('Open Symbols in new pane')
      .setDesc(
        'Enabled, always open a new pane when navigating to Symbols. Disabled, navigate in an already open pane (if one exists)',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.alwaysNewPaneForSymbols).onChange((value) => {
          settings.alwaysNewPaneForSymbols = value;
          settings.saveSettings();
        }),
      );
  }

  static setSymbolsInLineOrder(
    containerEl: HTMLElement,
    settings: SwitcherPlusSettings,
  ): void {
    new Setting(containerEl)
      .setName('List symbols in order they appear')
      .setDesc(
        'Enabled, symbols will be displayed in the (line) order they appear in the source text, indented under any preceding heading. Disabled, symbols will be grouped by type: Headings, Tags, Links, Embeds.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.symbolsInlineOrder).onChange((value) => {
          settings.symbolsInlineOrder = value;
          settings.saveSettings();
        }),
      );
  }
}
