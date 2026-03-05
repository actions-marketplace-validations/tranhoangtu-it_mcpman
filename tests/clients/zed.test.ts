import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { ZedHandler } from "../../src/clients/zed.js";

vi.mock("node:fs", () => ({
  default: {
    promises: {
      access: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
      mkdir: vi.fn(),
    },
  },
}));

describe("ZedHandler", () => {
  let handler: ZedHandler;

  beforeEach(() => {
    handler = new ZedHandler();
    vi.clearAllMocks();
  });

  describe("properties", () => {
    it("has correct type", () => {
      expect(handler.type).toBe("zed");
    });

    it("has correct displayName", () => {
      expect(handler.displayName).toBe("Zed");
    });
  });

  describe("getConfigPath()", () => {
    it("returns path containing zed and settings.json", () => {
      const configPath = handler.getConfigPath();
      // On macOS the path uses "Zed" (capitalized): ~/Library/Application Support/Zed/settings.json
      // On Linux the path uses lowercase "zed": ~/.config/zed/settings.json
      expect(configPath.toLowerCase()).toContain("zed");
      expect(configPath).toContain("settings.json");
    });
  });

  describe("isInstalled()", () => {
    it("returns true when zed config directory exists", async () => {
      vi.mocked(fs.promises.access).mockResolvedValueOnce(undefined);
      const result = await handler.isInstalled();
      expect(result).toBe(true);
    });

    it("returns false when zed config directory does not exist", async () => {
      vi.mocked(fs.promises.access).mockRejectedValueOnce(new Error("ENOENT"));
      const result = await handler.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe("readConfig()", () => {
    it("returns servers from context_servers key", async () => {
      const configData = {
        context_servers: {
          "zed-server": { command: "npx", args: ["-y", "zed-mcp"] },
        },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(configData));

      const config = await handler.readConfig();
      expect(config.servers).toHaveProperty("zed-server");
      expect(config.servers["zed-server"].command).toBe("npx");
    });

    it("returns empty servers when file does not exist", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(err);

      const config = await handler.readConfig();
      expect(config.servers).toEqual({});
    });

    it("returns empty servers when context_servers key is missing", async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify({}));

      const config = await handler.readConfig();
      expect(config.servers).toEqual({});
    });
  });

  describe("addServer()", () => {
    it("adds server to context_servers and writes atomically", async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({ context_servers: {} }));
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

      await handler.addServer("new-server", { command: "npx", args: ["-y", "my-server"] });

      expect(fs.promises.writeFile).toHaveBeenCalled();
      const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.context_servers["new-server"]).toEqual({
        command: "npx",
        args: ["-y", "my-server"],
      });
    });
  });

  describe("removeServer()", () => {
    it("removes server from context_servers", async () => {
      const existing = {
        context_servers: {
          keep: { command: "node", args: ["keep.js"] },
          remove: { command: "node", args: ["remove.js"] },
        },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(existing));
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

      await handler.removeServer("remove");

      const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.context_servers).toHaveProperty("keep");
      expect(parsed.context_servers).not.toHaveProperty("remove");
    });
  });

  describe("preserves other settings.json keys", () => {
    it("does not overwrite non-context_servers config properties", async () => {
      const existing = {
        context_servers: {},
        theme: "One Dark",
        font_size: 14,
        vim_mode: false,
      };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(existing));
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

      await handler.addServer("new", { command: "test" });

      const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.theme).toBe("One Dark");
      expect(parsed.font_size).toBe(14);
      expect(parsed.vim_mode).toBe(false);
    });
  });
});
