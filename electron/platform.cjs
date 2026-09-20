function platformCapabilities(platform = process.platform) {
  const id = String(platform);
  if (id === "win32") return { platform: id, label: "Windows", commandShim: true, deepLink: true, portable: true, status: "首发" };
  if (id === "darwin") return { platform: id, label: "macOS", commandShim: false, deepLink: true, portable: false, status: "适配中" };
  if (id === "linux") return { platform: id, label: "Linux", commandShim: false, deepLink: false, portable: false, status: "未承诺" };
  return { platform: id, label: id, commandShim: false, deepLink: false, portable: false, status: "未知" };
}

module.exports = { platformCapabilities };
