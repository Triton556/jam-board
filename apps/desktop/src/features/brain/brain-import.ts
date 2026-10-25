let retryId = 0;

/** Chromium caches rejected module requests as well as React.lazy's promise. */
export function retryBrainImport<Module>(
  load: () => Promise<Module>,
  request: (url: string) => Promise<Module> = (url) =>
    import(/* @vite-ignore */ url),
) {
  let failedUrl: URL | undefined;
  let recovered: { module: Module } | undefined;
  return async () => {
    try {
      if (recovered) return recovered.module;
      if (!failedUrl) return await load();
      const url = new URL(failedUrl);
      url.searchParams.set("jam_retry", `${Date.now()}-${++retryId}`);
      const module = await request(url.href);
      recovered = { module };
      return module;
    } catch (error) {
      const match = String(error).match(/(?:https?|tauri):\/\/[^\s"'<>]+/);
      if (match) {
        const url = new URL(match[0]);
        // Only retry an application module, never a URL from a remote error.
        if (
          url.origin === location.origin &&
          /\.(?:[cm]?js|tsx?)(?:$)/.test(url.pathname)
        )
          failedUrl = url;
      }
      throw error;
    }
  };
}
