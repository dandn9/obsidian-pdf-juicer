import { ExtraButtonComponent, FileView, Menu, Plugin, moment } from "obsidian";
import { EventEmitter } from "events";
import { Bookmarks } from "bookmarks";
import { SampleSettingsTab, PDFJuicerSettings } from "settings";

const ADD_BOOKMARK_EVENT = "add-bookmark";
const BOOKMARKS_BUTTON_ID = "pdf-juicer-bookmarks-btn";
const BOOKMARK_ADD_BUTTON_ID = "pdf-juicer-bookmark-add-btn";
const GRAB_MOUSE_BUTTON_ID = "pdf-juicer-grab-mouse-btn";

export default class MyPlugin extends Plugin {
  pdfEvents = new EventEmitter();
  bookmarks: Bookmarks;
  settings: PDFJuicerSettings;

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

    viewerContainer.addEventListener("scroll", () => {
      const addBookmark = viewContent.querySelector(
        `#${BOOKMARK_ADD_BUTTON_ID}`
      ) as HTMLElement;
      const currentPage = this.getCurrentPage(view);
      this.updateAddBookmarkButtonState(
        addBookmark,
        view.getDisplayText(),
        currentPage
      );
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
    element: HTMLElement,
    filename: string,
    pageNumber: number
  ) {
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
    console.log("Appending header elements", view, view.getDisplayText());
    const toolbarRight = view.containerEl.querySelector(
      ".pdf-toolbar-right"
    ) as HTMLDivElement;
    const toolbarLeft = view.containerEl.querySelector(
      ".pdf-toolbar-left"
    ) as HTMLDivElement;

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
