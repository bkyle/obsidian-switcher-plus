import { DefaultConfig, SwitcherPlusSettings } from 'src/settings';
import {
  isSymbolSuggestion,
  isSystemSuggestion,
  isOfType,
  isEditorSuggestion,
  isHeadingCache,
} from 'src/utils';
import {
  View,
  TagCache,
  ReferenceCache,
  TFile,
  WorkspaceLeaf,
  App,
  prepareQuery,
  renderResults,
  fuzzySearch,
  sortSearchResults,
  PreparedQuery,
  SearchResult,
  Scope,
  KeymapContext,
} from 'obsidian';
import {
  Mode,
  SymbolType,
  SymbolIndicators,
  HeadingIndicators,
  AnySuggestion,
  SymbolSuggestion,
  SymbolInfo,
  AnySymbolInfoPayload,
  AnyExSuggestionPayload,
  AnyExSuggestion,
} from 'src/types';

const ReferenceViews = ['backlink', 'outline', 'localgraph'];

interface SuggestionTarget {
  file: TFile;
  leaf: WorkspaceLeaf;
}

interface CurrentSuggestionInfo {
  currentSuggestion: AnySuggestion;
  isValidSymbolTarget: boolean;
}

interface ActiveEditorInfo {
  isValidSymbolTarget: boolean;
  currentEditor: WorkspaceLeaf;
}

function fileFromView(view: View): TFile {
  return (view as any)?.file;
}

export class ModeHandler {
  private _mode = Mode.Standard;
  public get mode(): Mode {
    return this._mode;
  }

  private isOpen = false;
  private symbolTarget: SuggestionTarget = null;
  private backupKeys: any[];
  private hasSearchTerm = false;

  constructor(
    private app: App,
    private settings: SwitcherPlusSettings,
    private scope: Scope,
    private chooser: any,
    private modalContainerEl: HTMLElement,
  ) {
    scope.register(['Ctrl'], 'n', this.navigateItems.bind(this));
    scope.register(['Ctrl'], 'p', this.navigateItems.bind(this));
  }

  openInMode(mode: Mode): void {
    this._mode = mode ?? Mode.Standard;
    if (mode === Mode.SymbolList) {
      this.symbolTarget = null;
    }
  }

  onOpen(): string {
    this.isOpen = true;
    let val = '';
    const { mode } = this;

    if (mode === Mode.EditorList) {
      val = DefaultConfig.editorListCommand;
    } else if (mode === Mode.SymbolList) {
      val = DefaultConfig.symbolListCommand;
    }

    if (mode !== Mode.Standard) {
      this.chooser.setSuggestions([]);
    }

    return val;
  }

  onClose(): void {
    this.isOpen = false;
  }

  onInput(input: string): Mode {
    const { chooser } = this;

    const currentSuggestion = chooser.values[chooser.selectedItem];
    const mode = this.parseInput(input, currentSuggestion);
    this.updateHelperTextForMode(this.modalContainerEl);
    this.updateKeymapForMode(mode);
    return mode;
  }

  updateSuggestions(input: string): void {
    const suggestions = this.getSuggestions(input);
    this.chooser.setSuggestions(suggestions);
  }

  onChooseSuggestion(sugg: AnyExSuggestion): void {
    if (isEditorSuggestion(sugg)) {
      const { item } = sugg;
      this.app.workspace.setActiveLeaf(item);
      item.view.setEphemeralState({ focus: true });
    } else {
      this.navigateToSymbol(sugg);
    }
  }

  renderSuggestion(sugg: AnyExSuggestion, parentEl: HTMLElement): void {
    let containerEl = parentEl;

    if (isSymbolSuggestion(sugg)) {
      const { item } = sugg;

      if (this.settings.symbolsInlineOrder && !this.hasSearchTerm) {
        parentEl.addClass(`qsp-symbol-l${item.indentLevel}`);
      }

      ModeHandler.addSymbolIndicator(item, containerEl);
      containerEl = createSpan({
        cls: 'qsp-symbol-text',
        parent: containerEl,
      });
    }

    const text = ModeHandler.getItemText(sugg.item);
    renderResults(containerEl, text, sugg.match);
  }

  navigateItems(_evt: KeyboardEvent, ctx: KeymapContext): boolean | void {
    const { isOpen, chooser } = this;

    if (isOpen) {
      const isNext = ctx.key === 'n';
      const index: number = chooser.selectedItem as number;
      chooser.setSelectedItem(isNext ? index + 1 : index - 1);
    }

    return false;
  }

  private parseInput(input: string, currentSuggestion: AnySuggestion): Mode {
    const { editorListCommand, symbolListCommand } = DefaultConfig;

    // determine if the editor command exists and if it's valid
    const hasEditorCmdPrefix = input.indexOf(editorListCommand) === 0;

    // get the index of symbol command and determine if it exists
    const symbolCmdIndex = input.indexOf(symbolListCommand);
    const hasSymbolCmd = symbolCmdIndex !== -1;
    const hasSymbolCmdPrefix = symbolCmdIndex === 0;

    // determine if the chooser is showing suggestions, and if so, is the
    // currently selected suggestion a valid target for symbols
    const currentSuggInfo = ModeHandler.getSelectedSuggestionInfo(
      hasSymbolCmd,
      currentSuggestion,
    );

    // determine if the current active editor pane a valid target for symbols
    const activeEditorInfo = this.getActiveEditorInfo(
      hasSymbolCmdPrefix,
      currentSuggInfo.isValidSymbolTarget,
    );

    return this.setupRunMode(
      hasEditorCmdPrefix,
      hasSymbolCmd,
      currentSuggInfo,
      activeEditorInfo,
    );
  }

  private getActiveEditorInfo(
    hasSymbolCmdPrefix: boolean,
    isCurrentSuggValidSymbolTarget: boolean,
  ): ActiveEditorInfo {
    const {
      activeLeaf,
      activeLeaf: { view },
    } = this.app.workspace;
    const { excludeViewTypes } = DefaultConfig;

    // determine if the current active editor pane is valid
    const isCurrentEditorValid = !excludeViewTypes.includes(view.getViewType());

    // whether or not the current active editor can be used as the target for
    // symbol search
    const isValidSymbolTarget =
      hasSymbolCmdPrefix &&
      !isCurrentSuggValidSymbolTarget &&
      isCurrentEditorValid &&
      !!fileFromView(view);

    return { isValidSymbolTarget, currentEditor: activeLeaf };
  }

  private static getSelectedSuggestionInfo(
    hasSymbolCmd: boolean,
    currentSuggestion: AnySuggestion,
  ): CurrentSuggestionInfo {
    let activeSugg = currentSuggestion;

    if (hasSymbolCmd && isSymbolSuggestion(activeSugg)) {
      // symbol suggestions don't point to a file and can't
      //themselves be used for symbol suggestions
      activeSugg = null;
    }

    // whether or not the current suggestion can be used for symbol search
    const isValidSymbolTarget = !!activeSugg;
    return { currentSuggestion: activeSugg, isValidSymbolTarget };
  }

  private setupRunMode(
    hasEditorCmdPrefix: boolean,
    hasSymbolCmd: boolean,
    currentSuggInfo: CurrentSuggestionInfo,
    activeEditorInfo: ActiveEditorInfo,
  ): Mode {
    let { mode, symbolTarget } = this;

    if (hasSymbolCmd) {
      mode = Mode.SymbolList;
      symbolTarget = ModeHandler.getTargetForSymbolMode(
        mode,
        currentSuggInfo,
        activeEditorInfo,
        symbolTarget,
      );
    } else if (hasEditorCmdPrefix) {
      mode = Mode.EditorList;
      symbolTarget = null;
    } else {
      mode = Mode.Standard;
      symbolTarget = null;
    }

    this.symbolTarget = symbolTarget;
    this._mode = mode;

    return mode;
  }

  private updateHelperTextForMode(containerEl: HTMLElement): void {
    const { mode } = this;
    const selector = '.prompt-instructions';

    const el = containerEl.querySelector<HTMLElement>(selector);
    if (el) {
      el.style.display = mode === Mode.Standard ? '' : 'none';
    }
  }

  private updateKeymapForMode(mode: Mode): void {
    const keys = (this.scope as any).keys;
    let { backupKeys = [] } = this;

    if (mode === Mode.Standard) {
      if (backupKeys.length) {
        backupKeys.forEach((key) => keys.push(key));
      }
      backupKeys = undefined;
    } else {
      // unregister unused hotkeys for custom modes
      for (let i = keys.length - 1; i >= 0; --i) {
        const key = keys[i];

        if (
          key.key === 'Enter' &&
          (key.modifiers === 'Meta' || key.modifiers === 'Shift')
        ) {
          keys.splice(i, 1);
          backupKeys.push(key);
        }
      }
    }

    this.backupKeys = backupKeys;
  }

  private static getTargetForSymbolMode(
    mode: Mode,
    currentSuggInfo: CurrentSuggestionInfo,
    activeEditorInfo: ActiveEditorInfo,
    oldSymbolTarget: SuggestionTarget,
  ): SuggestionTarget {
    // wether or not a symbol target file exists. Indicates that the previous
    // operation was a symbol operation
    const hasExistingSymbolTarget = mode === Mode.SymbolList && !!oldSymbolTarget;
    let symbolTarget: SuggestionTarget = oldSymbolTarget;

    if (currentSuggInfo.isValidSymbolTarget) {
      symbolTarget = ModeHandler.targetFromSuggestion(currentSuggInfo.currentSuggestion);
    } else if (!hasExistingSymbolTarget && activeEditorInfo.isValidSymbolTarget) {
      const leaf = activeEditorInfo.currentEditor;
      const file = fileFromView(leaf.view);
      symbolTarget = { file, leaf };
    }

    return symbolTarget;
  }

  private static targetFromSuggestion(sugg: AnySuggestion): SuggestionTarget {
    let file: TFile = null,
      leaf: WorkspaceLeaf = null,
      ret: SuggestionTarget = null;

    if (!isSymbolSuggestion(sugg)) {
      if (isSystemSuggestion(sugg)) {
        file = sugg.file;
      } else {
        leaf = sugg.item;
        file = fileFromView(leaf.view);
      }

      ret = { file, leaf };
    }

    return ret;
  }

  private static extractSearchQuery(input = '', mode: Mode): PreparedQuery {
    const { editorListCommand, symbolListCommand } = DefaultConfig;
    let startIndex = 0;

    if (mode === Mode.SymbolList) {
      const symbolCmdIndex = input.indexOf(symbolListCommand);
      startIndex = symbolCmdIndex + symbolListCommand.length;
    } else if (mode === Mode.EditorList) {
      startIndex = editorListCommand.length;
    }

    const queryStr = input.slice(startIndex).trim().toLowerCase();
    return prepareQuery(queryStr);
  }

  private getSuggestions(input: string): AnyExSuggestion[] {
    const { mode, symbolTarget } = this;
    const suggestions: AnyExSuggestion[] = [];

    const prepQuery = ModeHandler.extractSearchQuery(input, mode);
    const hasSearchTerm = prepQuery?.query?.length > 0;
    this.hasSearchTerm = hasSearchTerm;
    const items = this.getItems(mode, symbolTarget);

    const push = (item: AnyExSuggestionPayload, match: SearchResult) => {
      if (item instanceof WorkspaceLeaf) {
        suggestions.push({ type: 'Editor', item, match });
      } else {
        suggestions.push({ type: 'Symbol', item, match });
      }
    };

    items.forEach((item) => {
      let match: SearchResult = null;

      if (hasSearchTerm) {
        const text = ModeHandler.getItemText(item);
        match = fuzzySearch(prepQuery, text);

        if (match) {
          push(item, match);
        }
      } else {
        push(item, null);
      }
    });

    if (hasSearchTerm) {
      sortSearchResults(suggestions);
    }

    return suggestions;
  }

  private getItems(mode: Mode, symbolTarget: SuggestionTarget): AnyExSuggestionPayload[] {
    let items: AnyExSuggestionPayload[];

    if (mode === Mode.EditorList) {
      items = this.getOpenRootSplits();
    } else if (mode === Mode.SymbolList) {
      items = this.getSymbolsForTarget(symbolTarget);
    }

    return items;
  }

  private getOpenRootSplits(): WorkspaceLeaf[] {
    const {
      app: { workspace },
    } = this;
    const leaves: WorkspaceLeaf[] = [];

    const saveLeaf = (l: WorkspaceLeaf) => {
      if (!DefaultConfig.excludeViewTypes.includes(l.view.getViewType())) {
        leaves.push(l);
      }
    };

    (workspace as any).iterateLeaves(saveLeaf, workspace.rootSplit);
    return leaves;
  }

  private getSymbolsForTarget(symbolTarget: SuggestionTarget): SymbolInfo[] {
    const {
      app: { metadataCache },
    } = this;
    const ret: SymbolInfo[] = [];

    if (symbolTarget && symbolTarget.file) {
      const file = symbolTarget.file;
      const symbolData = metadataCache.getFileCache(file);

      if (symbolData) {
        const push = (symbols: AnySymbolInfoPayload[] = [], type: SymbolType) => {
          symbols.forEach((symbol) => ret.push({ symbol, type }));
        };

        push(symbolData.headings, SymbolType.Heading);
        push(symbolData.tags, SymbolType.Tag);
        push(symbolData.links, SymbolType.Link);
        push(symbolData.embeds, SymbolType.Embed);
      }
    }

    return this.settings.symbolsInlineOrder && !this.hasSearchTerm
      ? this.orderSymbolsByLineNumber(ret)
      : ret;
  }

  private orderSymbolsByLineNumber(symbols: SymbolInfo[] = []): SymbolInfo[] {
    const sorted = symbols.sort((a: SymbolInfo, b: SymbolInfo) => {
      const { start: aStart } = a.symbol.position;
      const { start: bStart } = b.symbol.position;
      const lineDiff = aStart.line - bStart.line;
      return lineDiff === 0 ? aStart.col - bStart.col : lineDiff;
    });

    let currIndentLevel = 0;

    sorted.forEach((si) => {
      let indentLevel = 0;
      if (isHeadingCache(si.symbol)) {
        currIndentLevel = si.symbol.level;
        indentLevel = si.symbol.level - 1;
      } else {
        indentLevel = currIndentLevel;
      }

      si.indentLevel = indentLevel;
    });

    return sorted;
  }

  private static getItemText(item: AnyExSuggestionPayload): string {
    let text;

    if (item instanceof WorkspaceLeaf) {
      text = item.getDisplayText();
    } else {
      text = ModeHandler.getSuggestionTextForSymbol(item);
    }

    return text;
  }

  private static getSuggestionTextForSymbol(symbolInfo: SymbolInfo): string {
    const { symbol } = symbolInfo;
    let text;

    if (isHeadingCache(symbol)) {
      text = symbol.heading;
    } else if (isOfType<TagCache>(symbol, 'tag')) {
      text = symbol.tag.slice(1);
    } else {
      const refCache = symbol as ReferenceCache;
      ({ link: text } = refCache);
      const { displayText } = refCache;

      if (displayText && displayText !== text) {
        text += `|${displayText}`;
      }
    }

    return text;
  }

  private navigateToSymbol(sugg: SymbolSuggestion): void {
    const { workspace } = this.app;

    // determine if the target is already open in a pane
    const {
      leaf,
      file: { path },
    } = this.findOpenEditorMatchingSymbolTarget();

    const {
      start: { line, col },
      end: endLoc,
    } = sugg.item.symbol.position;

    // object containing the state information for the target editor,
    // start with the range to highlight in target editor
    const eState = {
      startLoc: { line, col },
      endLoc,
      line,
      focus: true,
      cursor: {
        from: { line, ch: col },
        to: { line, ch: col },
      },
    };

    if (leaf && !this.settings.alwaysNewPaneForSymbols) {
      // activate the already open pane, and set state
      workspace.setActiveLeaf(leaf, true);
      leaf.view.setEphemeralState(eState);
    } else {
      workspace.openLinkText(path, '', true, { eState });
    }
  }

  private findOpenEditorMatchingSymbolTarget(): SuggestionTarget {
    const { file, leaf } = this.symbolTarget;
    const isTargetLeaf = !!leaf;

    const predicate = (l: WorkspaceLeaf) => {
      let val = false;
      const isRefView = ReferenceViews.includes(l.view.getViewType());
      const isTargetRefView =
        isTargetLeaf && ReferenceViews.includes(leaf.view.getViewType());

      if (!isRefView) {
        val =
          isTargetLeaf && !isTargetRefView ? l === leaf : fileFromView(l.view) === file;
      }

      return val;
    };

    const l = this.getOpenRootSplits().find(predicate);
    return { leaf: l, file };
  }

  private static addSymbolIndicator(symbolInfo: SymbolInfo, parentEl: HTMLElement): void {
    const { type, symbol } = symbolInfo;
    let indicator: string;

    if (isHeadingCache(symbol)) {
      indicator = HeadingIndicators[symbol.level];
    } else {
      indicator = SymbolIndicators[type];
    }

    createDiv({
      text: indicator,
      cls: 'qsp-symbol-indicator',
      parent: parentEl,
    });
  }
}
