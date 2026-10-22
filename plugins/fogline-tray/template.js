const k = 2; // fogline:lang
const GUIDS_TO_IGNORE = [
  "7820ae73-23e3-4229-82c1-e41cb67d5b9c",
  "7820ae74-23e3-4229-82c1-e41cb67d5b9c",
  "7820ae75-23e3-4229-82c1-e41cb67d5b9c",
];

const items = trayIcons
  .filter((icon) => icon.isVisible && icon.isPromoted && !GUIDS_TO_IGNORE.includes(icon.guid))
  .map((icon) => {
    const act = (action) => `invoke(SeelenCommand.SendSystemTrayIconAction, { id: ${JSON.stringify(icon.registryKey)}, action: ${JSON.stringify(action)} })`;
    return Button({
      tooltip: icon.tooltip,
      onClick: act("LeftClick"),
      onAuxClick: act("MiddleClick"),
      onContextMenu: act("RightClick"),
      content: Image({ path: icon.iconPath }),
    });
  });

items.push(
  Button({
    tooltip: ["More background apps", "その他のバックグラウンドアプリ", "其他背景程式"][k],
    content: Group({ content: Icon({ name: "LuChevronDown" }), style: focusedApp?.title === "@hsuan/fogline-tray" ? { "--fogline-open": "1" } : {} }),
    onClick: `trigger("@hsuan/fogline-tray");`,
  }),
);

if (self.placement === "left") items.reverse();
return items;
