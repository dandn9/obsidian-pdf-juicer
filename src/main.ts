import { ExtraButtonComponent, FileView, Menu, Plugin, moment } from "obsidian";
import { EventEmitter } from "events";
import { Bookmarks } from "bookmarks";
import { SampleSettingsTab, PDFJuicerSettings } from "settings";

const ADD_BOOKMARK_EVENT = "add-bookmark";
const BOOKMARKS_BUTTON_ID = "pdf-juicer-bookmarks-btn";
const BOOKMARK_ADD_BUTTON_ID = "pdf-juicer-bookmark-add-btn";
const GRAB_MOUSE_BUTTON_ID = "pdf-juicer-grab-mouse-btn";
const LINK_BACK_BUTTON_ID = "pdf-juicer-link-back-btn";
const LINK_BACK_CENTER_ID = "pdf-juicer-link-back-center";
const PDF_JUICER_BOUND_ATTR = "data-pdf-juicer-bound";
const MAX_LINK_BACK_PAGE_DISTANCE = 3;
const LINK_BACK_RESTORE_DELAYS_MS = [150, 300, 600, 1000];

interface PdfBackStackEntry {
  originLocation: PdfViewLocation;
  targetPage: number;
}

interface PendingPdfLinkClick {
  originLocation: PdfViewLocation;
  expiresAt: number;
}

interface PdfNavigationState {
  stack: PdfBackStackEntry[];
  pendingLink?: PendingPdfLinkClick;
  returningToPage?: number;
  restoreTimeouts: number[];
}

interface PdfViewLocation {
  page: number;
  pageOffsetRatio: number;
  scrollLeftRatio: number;
}

export default class MyPlugin extends Plugin {
  pdfEvents = new EventEmitter();
  bookmarks: Bookmarks;
  settings: PDFJuicerSettings;
  pdfNavigationStates = new WeakMap<FileView, PdfNavigationState>();

  async onload() {
    this.settings = await PDFJuicerSettings.load(this);
    this.addSettingTab(new SampleSettingsTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        if (view?.getViewType() === "pdf") this.juicePdf(view);
      })
    );
    this.addCommand({
      id: "toggle-grab-mouse-tool",
      name: "Toggle Grab Mouse Tool",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        if (view?.getViewType() === "pdf") {
          if (!checking) {
            this.toggleHandTool(view);
          }
          return true;
        }
        return false;
      },
      hotkeys: [{ key: "h", modifiers: ["Mod"] }],
    });

    this.addCommand({
      id: "toggle-bookmark",
      name: "Toggle Bookmark on Current Page",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        if (view?.getViewType() === "pdf") {
          if (!checking) {
            const currentPage = this.getCurrentPage(view);
            this.pdfEvents.emit(
              ADD_BOOKMARK_EVENT,
              view.getDisplayText(),
              currentPage,
              view.contentEl.querySelector(`#${BOOKMARK_ADD_BUTTON_ID}`)
            );
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "go-back-from-pdf-link",
      name: "Go Back from PDF Internal Link",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        if (view?.getViewType() === "pdf" && this.hasPdfLinkBack(view)) {
          if (!checking) {
            this.goBackFromPdfLink(view);
          }
          return true;
        }
        return false;
      },
    });

    this.pdfEvents.on(
      ADD_BOOKMARK_EVENT,
      async (fileName: string, pageNumber: number, element: HTMLElement) => {
        if (this.bookmarks.hasBookmark(fileName, pageNumber)) {
          await this.bookmarks.removeBookmark(fileName, pageNumber);
        } else {
          await this.bookmarks.saveBookmark(fileName, {
            page: pageNumber,
            timestamp: moment().toISOString(),
          });
        }
        this.updateAddBookmarkButtonState(element, fileName, pageNumber);
      }
    );
  }

  async juicePdf(view: FileView) {
    const viewContent = view.contentEl;
    const pdfToolbar = viewContent.querySelector(".pdf-toolbar") as HTMLElement;
    const pdfContainer = viewContent.querySelector(
      ".pdf-container"
    ) as HTMLElement;
    const viewerContainer = viewContent.querySelector(
      ".pdf-viewer-container"
    ) as HTMLElement;

    let isMouseDown = false;

    if (!pdfToolbar || !pdfContainer || !viewerContainer) {
      console.warn("Could not find PDF toolbar or container");
      return;
    }
    this.bookmarks = await Bookmarks.createInstance(this);
    this.appendHeaderElements(view);
    this.updateLinkBackButtonState(view);

    if (viewerContainer.hasAttribute(PDF_JUICER_BOUND_ATTR)) {
      return;
    }
    viewerContainer.setAttribute(PDF_JUICER_BOUND_ATTR, "true");
    const pageInput = view.containerEl.querySelector(
      "input.pdf-page-input"
    ) as HTMLInputElement | null;

    viewerContainer.addEventListener("scroll", () => {
      const addBookmark = viewContent.querySelector(
        `#${BOOKMARK_ADD_BUTTON_ID}`
      ) as HTMLElement | null;
      const currentPage = this.getCurrentPage(view);
      this.updateAddBookmarkButtonState(
        addBookmark,
        view.getDisplayText(),
        currentPage
      );
      this.handlePdfPageChange(view);
    });

    viewerContainer.addEventListener("pointerdown", (event) => {
      isMouseDown = true;
    });
    viewerContainer.addEventListener("pointerup", (event) => {
      isMouseDown = false;
    });
    viewerContainer.addEventListener("pointermove", (event) => {
      if (this.isHandToolActive(view) && isMouseDown) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const scrollAmountY =
          -event.movementY * this.settings.grabMouseSensitivity;
        viewerContainer.scrollBy(0, scrollAmountY);
      }
    });
    viewerContainer.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const link = target?.closest("a") as HTMLAnchorElement | null;
        if (!link || !viewerContainer.contains(link)) return;
        if (!this.isInternalPdfLink(link)) return;

        const state = this.getPdfNavigationState(view);
        state.pendingLink = {
          originLocation: this.getPdfViewLocation(view, link),
          expiresAt: Date.now() + 2000,
        };
        window.setTimeout(() => this.handlePdfPageChange(view), 100);
        window.setTimeout(() => this.handlePdfPageChange(view), 500);
        window.setTimeout(() => this.handlePdfPageChange(view), 1000);
      },
      true
    );
    viewerContainer.addEventListener(
      "contextmenu",
      (event) => this.handleRightClickBack(view, event),
      true
    );
    pageInput?.addEventListener("input", () => this.handlePdfPageChange(view));
    pageInput?.addEventListener("change", () => this.handlePdfPageChange(view));
  }

  private getPdfNavigationState(view: FileView): PdfNavigationState {
    let state = this.pdfNavigationStates.get(view);
    if (!state) {
      state = { stack: [], restoreTimeouts: [] };
      this.pdfNavigationStates.set(view, state);
    }
    return state;
  }

  private handlePdfPageChange(view: FileView) {
    const state = this.getPdfNavigationState(view);
    const currentPage = this.getCurrentPage(view);

    if (state.pendingLink) {
      if (state.pendingLink.originLocation.page !== currentPage) {
        state.stack.push({
          originLocation: state.pendingLink.originLocation,
          targetPage: currentPage,
        });
        state.pendingLink = undefined;
      } else if (Date.now() > state.pendingLink.expiresAt) {
        state.pendingLink = undefined;
      }
    }

    this.updateLinkBackButtonState(view);
  }

  private isInternalPdfLink(link: HTMLAnchorElement): boolean {
    const href = link.getAttribute("href") ?? "";
    const hasExternalProtocol = /^(https?:|mailto:|file:)/i.test(href);

    return (
      link.classList.contains("internalLink") ||
      Boolean(link.dataset.dest) ||
      href.startsWith("#") ||
      (!hasExternalProtocol && !link.hasAttribute("target"))
    );
  }

  private hasPdfLinkBack(view: FileView): boolean {
    return this.getPdfNavigationState(view).stack.length > 0;
  }

  private goBackFromPdfLink(view: FileView): boolean {
    const state = this.getPdfNavigationState(view);
    const entry = state.stack.pop();
    if (!entry) return false;

    state.pendingLink = undefined;
    this.clearRestoreTimeouts(state);
    state.returningToPage = entry.originLocation.page;
    this.gotoPage(view, entry.originLocation.page);
    this.schedulePdfViewLocationRestore(view, entry.originLocation);
    return true;
  }

  private handleRightClickBack(view: FileView, event: MouseEvent) {
    if (!this.hasPdfLinkBack(view)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.goBackFromPdfLink(view);
  }

  private getPdfViewLocation(
    view: FileView,
    element: HTMLElement
  ): PdfViewLocation {
    const viewerContainer = this.getViewerContainer(view);
    const pageElement = element.closest(".page[data-page-number]") as
      | HTMLElement
      | null;

    if (!viewerContainer || !pageElement) {
      return {
        page: this.getCurrentPage(view),
        pageOffsetRatio: 0,
        scrollLeftRatio: 0,
      };
    }

    const page = Number(pageElement.dataset.pageNumber);
    const viewerRect = viewerContainer.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const pageOffset = viewerRect.top - pageRect.top;
    const pageOffsetRatio = this.clampRatio(
      pageOffset / pageElement.clientHeight
    );
    const maxScrollLeft =
      viewerContainer.scrollWidth - viewerContainer.clientWidth;
    const scrollLeftRatio =
      maxScrollLeft > 0
        ? this.clampRatio(viewerContainer.scrollLeft / maxScrollLeft)
        : 0;

    return { page, pageOffsetRatio, scrollLeftRatio };
  }

  private schedulePdfViewLocationRestore(
    view: FileView,
    location: PdfViewLocation
  ) {
    const state = this.getPdfNavigationState(view);

    state.restoreTimeouts = LINK_BACK_RESTORE_DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => {
        const isLastAttempt = index === LINK_BACK_RESTORE_DELAYS_MS.length - 1;
        const restored = this.restorePdfViewOffset(view, location);

        if (restored || isLastAttempt) {
          this.clearRestoreTimeouts(state);
          state.returningToPage = undefined;
          this.updateLinkBackButtonState(view);
        }
      }, delay)
    );
  }

  private restorePdfViewOffset(
    view: FileView,
    location: PdfViewLocation
  ): boolean {
    const currentPage = this.getCurrentPage(view);
    if (currentPage !== location.page) return false;

    const viewerContainer = this.getViewerContainer(view);
    const pageElement = this.getPageElement(view, location.page);
    if (!viewerContainer || !pageElement) return false;

    const viewerRect = viewerContainer.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const currentPageOffset = viewerRect.top - pageRect.top;
    const targetPageOffset = pageElement.clientHeight * location.pageOffsetRatio;
    const deltaY = targetPageOffset - currentPageOffset;
    const maxScrollLeft =
      viewerContainer.scrollWidth - viewerContainer.clientWidth;

    viewerContainer.scrollBy(0, deltaY);
    viewerContainer.scrollLeft =
      maxScrollLeft > 0 ? maxScrollLeft * location.scrollLeftRatio : 0;
    return true;
  }

  private clearRestoreTimeouts(state: PdfNavigationState) {
    state.restoreTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    state.restoreTimeouts = [];
  }

  private getViewerContainer(view: FileView): HTMLElement | null {
    return view.contentEl.querySelector(".pdf-viewer-container");
  }

  private getPageElement(view: FileView, page: number): HTMLElement | null {
    return view.contentEl.querySelector(`.page[data-page-number="${page}"]`);
  }

  private clampRatio(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  private updateLinkBackButtonState(view: FileView) {
    const state = this.getPdfNavigationState(view);
    const currentPage = this.getCurrentPage(view);
    const button = view.containerEl.querySelector(
      `#${LINK_BACK_BUTTON_ID}`
    ) as HTMLElement | null;

    if (!state.returningToPage) {
      while (
        state.stack.length > 0 &&
        Math.abs(currentPage - state.stack[state.stack.length - 1].targetPage) >
          MAX_LINK_BACK_PAGE_DISTANCE
      ) {
        state.stack.pop();
      }
    }

    if (!button) return;
    button.style.display = state.stack.length > 0 ? "" : "none";
  }

  private isHandToolActive(view: FileView): boolean {
    return Boolean(
      view.containerEl
        .querySelector(`#${GRAB_MOUSE_BUTTON_ID}`)
        ?.classList.contains("is-active")
    );
  }

  private toggleHandTool(view: FileView) {
    view.containerEl
      .querySelector(`#${GRAB_MOUSE_BUTTON_ID}`)
      ?.classList.toggle("is-active");
  }

  private updateAddBookmarkButtonState(
    element: HTMLElement | null,
    filename: string,
    pageNumber: number
  ) {
    if (!element) return;
    if (this.bookmarks.hasBookmark(filename, pageNumber)) {
      element.addClass("is-active");
    } else {
      element.removeClass("is-active");
    }
  }
  getCurrentPage(view: FileView): number {
    const currentPageInput = view.containerEl.querySelector(
      "input.pdf-page-input"
    ) as HTMLInputElement;
    return Number(currentPageInput.value);
  }
  gotoPage(view: FileView, pageNumber: number) {
    const pageInput = view.containerEl.querySelector(
      "input.pdf-page-input"
    ) as HTMLInputElement;
    pageInput.value = pageNumber.toString();
    pageInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  appendHeaderElements(view: FileView) {
    const toolbar = view.containerEl.querySelector(
      ".pdf-toolbar"
    ) as HTMLDivElement;
    const toolbarRight = view.containerEl.querySelector(
      ".pdf-toolbar-right"
    ) as HTMLDivElement;
    const toolbarLeft = view.containerEl.querySelector(
      ".pdf-toolbar-left"
    ) as HTMLDivElement;
    let toolbarCenter = toolbar.querySelector(
      `#${LINK_BACK_CENTER_ID}`
    ) as HTMLDivElement | null;

    toolbar.style.position = "relative";
    if (!toolbarCenter) {
      toolbarCenter = toolbar.createDiv({ attr: { id: LINK_BACK_CENTER_ID } });
      toolbarCenter.style.position = "absolute";
      toolbarCenter.style.left = "50%";
      toolbarCenter.style.top = "50%";
      toolbarCenter.style.transform = "translate(-50%, -50%)";
      toolbarCenter.style.pointerEvents = "none";
      toolbarCenter.style.zIndex = "1";
    }

    if (!toolbarCenter.querySelector(`#${LINK_BACK_BUTTON_ID}`)) {
      const linkBack = new ExtraButtonComponent(toolbarCenter);
      linkBack.extraSettingsEl.id = LINK_BACK_BUTTON_ID;
      linkBack.setIcon("arrow-left");
      linkBack.setTooltip("Back to previous PDF link position");
      linkBack.extraSettingsEl.style.display = "none";
      linkBack.extraSettingsEl.style.pointerEvents = "auto";
      linkBack.onClick(() => this.goBackFromPdfLink(view));
    }

    if (!toolbarRight.querySelector(`#${BOOKMARKS_BUTTON_ID}`)) {
      const allBookmarks = new ExtraButtonComponent(toolbarRight);
      allBookmarks.extraSettingsEl.id = BOOKMARKS_BUTTON_ID;
      allBookmarks.setIcon("bookmark");
      allBookmarks.extraSettingsEl.addEventListener("click", (event) => {
        const menu = new Menu();
        const bookmarks = this.bookmarks.getBookmarks(view.getDisplayText());
        const bookmarksSorted = bookmarks.sort(
          (a, b) => -moment(a.timestamp).diff(moment(b.timestamp))
        );
        bookmarksSorted.forEach((element) => {
          menu.addItem((item) =>
            item
              .setTitle(
                `Page ${element.page} - ${moment(element.timestamp).format(
                  "MMM D, YYYY h:mm A"
                )}`
              )
              .onClick(() => this.gotoPage(view, element.page))
          );
        });
        menu.showAtMouseEvent(event);
      });
    }

    if (!toolbarLeft.querySelector(`#${BOOKMARK_ADD_BUTTON_ID}`)) {
      const addBookmark = new ExtraButtonComponent(toolbarLeft);
      addBookmark.extraSettingsEl.id = BOOKMARK_ADD_BUTTON_ID;
      addBookmark.setIcon("bookmark-plus");
      addBookmark.onClick(() => {
        const currentPage = view.containerEl.querySelector(
          "input.pdf-page-input"
        ) as HTMLInputElement;
        this.pdfEvents.emit(
          ADD_BOOKMARK_EVENT,
          view.getDisplayText(),
          Number(currentPage.value),
          addBookmark.extraSettingsEl
        );
      });
    }

    if (!toolbarLeft.querySelector(`#${GRAB_MOUSE_BUTTON_ID}`)) {
      const grabMouse = new ExtraButtonComponent(toolbarLeft);
      grabMouse.extraSettingsEl.id = GRAB_MOUSE_BUTTON_ID;
      grabMouse.setIcon("hand");
      grabMouse.onClick(() => {
        this.toggleHandTool(view);
      });
    }
  }
}
