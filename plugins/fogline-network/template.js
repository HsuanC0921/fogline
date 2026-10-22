if (!online) return icon("LuWifiOff");
if (usingInterface?.type === "IEEE80211") return icon("LuWifi");
return icon("LuEthernetPort");
