import { Plugin } from "obsidian";
export interface Bookmark {
  page: number;
  timestamp: string;
  notes?: string;
}

const BOOKMARKS_KEY = "bookmarks";
export class Bookmarks {
  inMemoryBookmarks: Record<string, Bookmark[]> = {};
  plugin: Plugin;

  private constructor() {}
  static async createInstance(plugin: Plugin): Promise<Bookmarks> {
    const bookmarks = new Bookmarks();
    bookmarks.plugin = plugin;
    bookmarks.inMemoryBookmarks = await bookmarks.getBookmarkDataDisk();
    return bookmarks;
  }

  hasBookmark(filename: string, pageNumber: number): boolean {
    const fileBookmarks = this.inMemoryBookmarks[filename] || [];
    return fileBookmarks.some((b) => b.page === pageNumber);
  }

  getBookmarks(filename: string): Bookmark[] {
    return this.inMemoryBookmarks[filename] || [];
  }

  async getBookmarkDataDisk(): Promise<Record<string, Bookmark[]>> {
    const pluginData = (await this.plugin.loadData()) ?? {};
    const bookmarkData = pluginData[BOOKMARKS_KEY] ?? {};
    return bookmarkData;
  }
  async saveBookmarkData(data: Record<string, Bookmark[]>): Promise<void> {
    const entireData = (await this.plugin.loadData()) ?? {};
    await this.plugin.saveData({ ...entireData, [BOOKMARKS_KEY]: data });
    this.inMemoryBookmarks = data;
  }

  async removeBookmark(filename: string, pageNumber: number): Promise<void> {
    const data = this.inMemoryBookmarks;
    const fileBookmarks = data[filename] || [];
    data[filename] = fileBookmarks.filter((b) => b.page !== pageNumber);
    this.saveBookmarkData(data);
  }
  async saveBookmark(filename: string, bookmark: Bookmark): Promise<void> {
    const data = this.inMemoryBookmarks;
    const fileBookmarks = data[filename] || [];
    fileBookmarks.push(bookmark);
    data[filename] = fileBookmarks;
    await this.saveBookmarkData(data);
  }
}
