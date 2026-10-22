if (!batteries.length) return "";
const full = batteries.reduce((t, b) => t + (Number.isFinite(b.energyFull) ? b.energyFull : 0), 0);
const pct = Math.max(0, Math.min(100, Math.round(full > 0
  ? batteries.reduce((t, b) => t + (Number.isFinite(b.energy) ? b.energy : 0), 0) / full * 100
  : batteries.reduce((t, b) => t + b.percentage, 0) / batteries.length)));
const charging = power?.acLineStatus === 1 || batteries.some((b) => b.state.toLowerCase() === "charging");
const name = charging ? "LuBatteryCharging" : pct > 66 ? "LuBatteryFull" : pct > 33 ? "LuBatteryMedium" : pct > 12 ? "LuBatteryLow" : "LuBatteryWarning";
return [icon(name), " ", pct + "%"];
