import type { SelectedFileData } from "@zcode/shared";

/** 供 Desktop/Web 的平台适配器复用；UI 通过 IPlatformService 调用。 */
export function selectBrowserFileData(options: {
  accept: string;
  maxBytes: number;
}): Promise<SelectedFileData | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.hidden = true;
    const cleanup = () => {
      input.remove();
      input.onchange = null;
      input.oncancel = null;
    };
    input.oncancel = () => {
      cleanup();
      resolve(null);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size <= 0 || file.size > options.maxBytes) {
        reject(
          Object.assign(new Error("Selected file exceeds the import limit"), {
            kind: "limit_exceeded",
          }),
        );
        return;
      }
      void file.arrayBuffer().then(
        (data) => resolve({ name: file.name, data }),
        () => reject(new Error("Selected file could not be read")),
      );
    };
    try {
      document.body.append(input);
      input.click();
    } catch {
      cleanup();
      reject(new Error("File picker could not be opened"));
    }
  });
}
