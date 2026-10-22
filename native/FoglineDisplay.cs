// Event-driven local bridge. No registry writes, polling, shell restart or elevation.
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Diagnostics;
using System.Threading;
using Microsoft.Win32;

internal static class FoglineDisplay {
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder name,int length);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder name,int length);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int size; public NativeRect monitor,work; public uint flags; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out NativeRect rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string title);
    static WinEvent shellCallback;
    static bool SeelenRunning() {
        var processes=Process.GetProcessesByName("seelen-ui");
        bool running=processes.Length>0;
        foreach(var process in processes) process.Dispose();
        return running;
    }
    static void AdjustShellWindow(IntPtr window) {
        var name=new StringBuilder(256); GetClassName(window,name,256);
        string cls=name.ToString();
        if(cls=="Shell_TrayWnd" || cls=="Shell_SecondaryTrayWnd") {
            if(IsWindowVisible(window) && SeelenRunning()) ShowWindow(window,0);
            return;
        }
        if(cls!="Windows.UI.Core.CoreWindow" && cls!="ToastChildWindow") return;
        var title=new StringBuilder(256); GetWindowText(window,title,256);
        if(cls!="ToastChildWindow" && title.ToString()!="New notification" && title.ToString()!="新通知") return;
        uint pid; GetWindowThreadProcessId(window,out pid);
        try { using(var process=Process.GetProcessById((int)pid)) {
            if(process.ProcessName!="ShellExperienceHost") return;
        }} catch { return; }
        if(!SeelenRunning()) return;
        NativeRect rect; if(!GetWindowRect(window,out rect) || rect.right<=rect.left || rect.bottom<=rect.top) return;
        var info=new MonitorInfo(); info.size=Marshal.SizeOf(typeof(MonitorInfo));
        if(GetMonitorInfo(MonitorFromWindow(window,2),ref info))
            SetWindowPos(window,IntPtr.Zero,info.work.right-(rect.right-rect.left)-12,Math.Max(info.work.top,info.monitor.top+40),0,0,0x1|0x4|0x10);
    }
    // ---- Fullscreen: the menu bar and Dock step aside while an app covers the whole monitor, like macOS.
    // Seelen's own detection misses borderless/F11/video fullscreen, so it is done here from the same foreground hook.
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    delegate bool EnumWindowsProc(IntPtr window,IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc,IntPtr param);
    static bool barsHidden;
    static long lastBarSweep;
    static readonly System.Collections.Generic.HashSet<IntPtr> hiddenBars=new System.Collections.Generic.HashSet<IntPtr>();
    static WinEvent fullscreenForegroundCallback, fullscreenLocationCallback;
    static string ClassOf(IntPtr window) { var name=new StringBuilder(64); GetClassName(window,name,64); return name.ToString(); }
    static string ProcessOf(IntPtr window) {
        uint pid; GetWindowThreadProcessId(window,out pid);
        try { using(var process=Process.GetProcessById((int)pid)) return process.ProcessName; } catch { return ""; }
    }
    static bool IsFullscreenWindow(IntPtr window,out IntPtr monitor) {
        monitor=IntPtr.Zero;
        if(window==IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return false;
        // a title bar means a maximised window, which leaves room for the bars
        if((GetWindowLong(window,-16)&0xC00000)==0xC00000) return false;
        NativeRect rect; if(!GetWindowRect(window,out rect)) return false;
        monitor=MonitorFromWindow(window,2);
        var info=new MonitorInfo(); info.size=Marshal.SizeOf(typeof(MonitorInfo));
        if(!GetMonitorInfo(monitor,ref info)) return false;
        if(rect.left>info.monitor.left || rect.top>info.monitor.top || rect.right<info.monitor.right || rect.bottom<info.monitor.bottom) return false;
        string cls=ClassOf(window);
        if(cls=="Progman" || cls=="WorkerW" || cls=="Shell_TrayWnd" || cls=="Shell_SecondaryTrayWnd" || cls=="Windows.UI.Core.CoreWindow") return false;
        string name=ProcessOf(window);
        return name!="" && name!="seelen-ui" && name!="FoglineDisplay" && name!="SearchHost" && name!="StartMenuExperienceHost" && name!="ShellExperienceHost";
    }
    // the menu bar and Dock: full-width, topmost Seelen windows stuck to the top or bottom edge of a monitor
    static bool IsSeelenBar(IntPtr window,uint seelen,IntPtr monitor) {
        uint pid; GetWindowThreadProcessId(window,out pid);
        if(pid!=seelen || ClassOf(window)!="Tauri Window" || (GetWindowLong(window,-20)&0x8)==0) return false;
        if(MonitorFromWindow(window,2)!=monitor) return false;
        var info=new MonitorInfo(); info.size=Marshal.SizeOf(typeof(MonitorInfo));
        NativeRect rect; if(!GetMonitorInfo(monitor,ref info) || !GetWindowRect(window,out rect)) return false;
        int height=rect.bottom-rect.top;
        return rect.right-rect.left>=info.monitor.right-info.monitor.left && height<(info.monitor.bottom-info.monitor.top)/3 && (rect.top<=info.monitor.top || rect.bottom>=info.monitor.bottom);
    }
    static uint SeelenProcess() {
        var processes=Process.GetProcessesByName("seelen-ui"); uint id=processes.Length>0 ? (uint)processes[0].Id : 0;
        foreach(var process in processes) process.Dispose();
        return id;
    }
    static void HideBars(IntPtr monitor) {
        uint seelen=SeelenProcess(); if(seelen==0) return;
        EnumWindows(delegate(IntPtr window,IntPtr param) {
            if(IsWindowVisible(window) && IsSeelenBar(window,seelen,monitor)) { hiddenBars.Add(window); ShowWindow(window,0); }
            return true;
        },IntPtr.Zero);
    }
    static void RestoreBars() {
        foreach(var window in hiddenBars) ShowWindow(window,8);
        hiddenBars.Clear();
    }
    static void CheckFullscreen() {
        IntPtr foreground=GetForegroundWindow();
        // a Seelen popup opened over a fullscreen app must not bring the bars back
        if(foreground!=IntPtr.Zero && ClassOf(foreground)=="Tauri Window") return;
        IntPtr monitor;
        if(IsFullscreenWindow(foreground,out monitor)) {
            long now=Environment.TickCount;
            if(barsHidden && now-lastBarSweep<500) return;
            lastBarSweep=now; HideBars(monitor); barsHidden=true;
        } else if(barsHidden) { RestoreBars(); barsHidden=false; }
    }
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {
        public int size, flags; public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public int left,top,right,bottom;
    }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [ComImport, Guid("87955690-e627-11d2-8ddb-00105a2799b5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ILanguageBar {
        void AdviseEventSink(IntPtr sink,IntPtr window,uint flags,IntPtr cookie);
        void UnadviseEventSink(uint cookie);
        void GetThreadMarshalInterface(uint thread,uint type,ref Guid iid,out IntPtr result);
        void GetThreadLangBarItemMgr(uint thread,out IntPtr manager,out uint resultThread);
        void GetInputProcessorProfiles(uint thread,out IntPtr profiles,out uint resultThread);
        void RestoreLastFocus(out uint thread,bool previous);
        void SetModalInput(IntPtr sink,uint thread,uint flags);
        void ShowFloating(uint flags);
        void GetShowFloatingStatus(out uint flags);
    }
    static void ShowLanguageBar() {
        object instance=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ebb08c45-6c4a-4fdc-ae53-4eb8c4c7db8e")));
        try { ((ILanguageBar)instance).ShowFloating(1|0x80); }
        finally { Marshal.ReleaseComObject(instance); }
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("imm32.dll")] static extern IntPtr ImmGetDefaultIMEWnd(IntPtr window);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
    delegate void WinEvent(IntPtr hook,uint ev,IntPtr window,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint id; public UIntPtr w; public IntPtr l; public uint time; public int x,y; public uint reserved; }
    [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr window,uint min,uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    static IntPtr inputTarget;
    static uint inputThread;
    static WinEvent inputCallback;
    static bool IsInputApp(IntPtr window) {
        if(window==IntPtr.Zero || !IsWindowVisible(window) || GetWindowTextLength(window)==0 || (GetWindowLong(window,-20)&0x80)!=0) return false;
        try {
            uint pid; GetWindowThreadProcessId(window,out pid);
            using(var process=Process.GetProcessById((int)pid)) {
                string name=process.ProcessName;
                return name!="seelen-ui" && name!="FoglineDisplay" && name!="TextInputHost" && name!="ShellExperienceHost" && name!="StartMenuExperienceHost" && name!="SearchHost";
            }
        } catch { return false; }
    }
    static void TrackInput(IntPtr window) { if(IsInputApp(window)) inputTarget=window; }
    static Thread StartInputTracking() {
        inputTarget=IntPtr.Zero;
        var thread=new Thread(delegate() {
            inputThread=GetCurrentThreadId();
            inputCallback=delegate(IntPtr h,uint ev,IntPtr window,int obj,int child,uint tid,uint time) { TrackInput(window); };
            IntPtr hook=SetWinEventHook(3,3,IntPtr.Zero,inputCallback,0,0,2);
            shellCallback=delegate(IntPtr h,uint ev,IntPtr window,int obj,int child,uint tid,uint time) {
                if(obj==0 && child==0) AdjustShellWindow(window);
            };
            IntPtr shellHook=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,shellCallback,0,0,2);
            fullscreenForegroundCallback=delegate(IntPtr h,uint ev,IntPtr window,int obj,int child,uint tid,uint time) { CheckFullscreen(); };
            fullscreenLocationCallback=delegate(IntPtr h,uint ev,IntPtr window,int obj,int child,uint tid,uint time) { if(obj==0 && child==0 && window==GetForegroundWindow()) CheckFullscreen(); };
            IntPtr fullscreenForegroundHook=SetWinEventHook(3,3,IntPtr.Zero,fullscreenForegroundCallback,0,0,2);
            IntPtr fullscreenLocationHook=SetWinEventHook(0x800B,0x800B,IntPtr.Zero,fullscreenLocationCallback,0,0,2);
            CheckFullscreen();
            AdjustShellWindow(FindWindow("Shell_TrayWnd",null));
            IntPtr first=GetForegroundWindow();
            for(int i=0;i<100 && first!=IntPtr.Zero;i++,first=GetWindow(first,2)) if(IsInputApp(first)) { inputTarget=first; break; }
            Message message;
            try { while(GetMessage(out message,IntPtr.Zero,0,0)>0) { TranslateMessage(ref message); DispatchMessage(ref message); } }
            finally {
                if(hook!=IntPtr.Zero) UnhookWinEvent(hook); if(shellHook!=IntPtr.Zero) UnhookWinEvent(shellHook);
                if(fullscreenForegroundHook!=IntPtr.Zero) UnhookWinEvent(fullscreenForegroundHook); if(fullscreenLocationHook!=IntPtr.Zero) UnhookWinEvent(fullscreenLocationHook);
                RestoreBars();
            }
        });
        thread.IsBackground=true; thread.Start(); return thread;
    }
    static int ImeControl(IntPtr ime,int command,int value) {
        UIntPtr result;
        if(SendMessageTimeout(ime,0x283,(IntPtr)command,(IntPtr)value,2,150,out result)==IntPtr.Zero) throw new Exception("Input method did not respond");
        return unchecked((int)result.ToUInt64());
    }
    static string InputState(bool? desired, bool? fullShape = null) {
        IntPtr target=inputTarget;
        if(!IsInputApp(target)) return "{\"available\":false}";
        uint pid; uint tid=GetWindowThreadProcessId(target,out pid);
        string code;
        try { code=System.Globalization.CultureInfo.GetCultureInfo((int)(GetKeyboardLayout(tid).ToInt64()&0xffff)).TwoLetterISOLanguageName; }
        catch { return "{\"available\":false}"; }
        if(code!="zh" && code!="ja" && code!="ko") return "{\"available\":false,\"languageCode\":\""+code+"\"}";
        var info=new GuiThreadInfo(); info.size=Marshal.SizeOf(typeof(GuiThreadInfo));
        IntPtr focus=GetGUIThreadInfo(tid,ref info) && info.focus!=IntPtr.Zero ? info.focus : target;
        IntPtr ime=ImmGetDefaultIMEWnd(focus);
        if(ime==IntPtr.Zero) return "{\"available\":false,\"languageCode\":\""+code+"\"}";
        int conversion=ImeControl(ime,1,0);
        bool open=ImeControl(ime,5,0)!=0;
        bool native=open && (conversion&1)!=0;
        if(desired.HasValue && native!=desired.Value) {
            if(inputTarget!=target) throw new Exception("Typing target changed; switch canceled");
            ImeControl(ime,6,desired.Value || code!="ja" ? 1 : 0);
            ImeControl(ime,2,desired.Value ? conversion|1 : conversion&~1);
            conversion=ImeControl(ime,1,0); open=ImeControl(ime,5,0)!=0;
            native=open && (conversion&1)!=0;
            if(native!=desired.Value) throw new Exception("This input method does not support direct IMM switching; use its keyboard shortcut");
        }
        if(fullShape.HasValue && ((conversion&8)!=0)!=fullShape.Value) {
            if(inputTarget!=target) throw new Exception("Typing target changed; switch canceled");
            ImeControl(ime,2,fullShape.Value ? conversion|8 : conversion&~8);
            conversion=ImeControl(ime,1,0);
            if(((conversion&8)!=0)!=fullShape.Value) throw new Exception("This input method does not support direct width switching; use its native language bar");
        }
        return "{\"available\":true,\"languageCode\":\""+code+"\",\"native\":"+(native?"true":"false")+",\"fullShape\":"+((conversion&8)!=0?"true":"false")+",\"katakana\":"+((conversion&2)!=0?"true":"false")+"}";
    }
    [StructLayout(LayoutKind.Sequential)] struct Matrix {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst=25)] public float[] values;
    }
    [DllImport("Magnification.dll")] static extern bool MagInitialize();
    [DllImport("Magnification.dll")] static extern bool MagUninitialize();
    [DllImport("Magnification.dll")] static extern bool MagGetFullscreenColorEffect(out Matrix effect);
    [DllImport("Magnification.dll")] static extern bool MagSetFullscreenColorEffect(ref Matrix effect);

    // IThemeManager2 ABI, originally documented by namazso (MIT, see THIRD-PARTY.txt).
    [ComImport, Guid("c1e8c83e-845d-4d95-81db-e283fdffc000"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IThemeManager2 {
        void Init(uint flags); void InitAsync(IntPtr hwnd, int x); void Refresh();
        void RefreshAsync(IntPtr hwnd, int x); void RefreshComplete();
        void GetThemeCount(out int count); void GetTheme(int index, out IntPtr theme);
        void IsThemeDisabled(int index, out int disabled); void GetCurrentTheme(out int index);
        void SetCurrentTheme(IntPtr hwnd, int index, int apply, uint flags, uint pack);
        void GetCustomTheme(out int index); void GetDefaultTheme(out int index);
        void CreateThemePack(IntPtr hwnd, string path, uint flags);
        void CloneAndSetCurrentTheme(IntPtr hwnd, string path, out string result);
        void InstallThemePack(IntPtr hwnd, string path, int x, uint flags, out string result, out IntPtr theme);
        void DeleteTheme(string path); void OpenTheme(IntPtr hwnd, string path, uint pack);
        void AddAndSelectTheme(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string path, uint flags, uint pack);
    }
    static bool warm;
    static readonly string warmthPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"com.seelen.seelen-ui","fogline-native","warmth.txt");
    static int warmStrength=LoadWarmStrength();
    static int LoadWarmStrength() {
        try { int value; if(int.TryParse(File.ReadAllText(warmthPath).Trim(),out value) && value>=0 && value<=100) return value; }
        catch(IOException) {} catch(UnauthorizedAccessException) {}
        return 50;
    }
    static Matrix original, applied;
    static bool Same(Matrix a, Matrix b) {
        if (a.values == null || b.values == null) return false;
        for (int i=0;i<25;i++) if (Math.Abs(a.values[i]-b.values[i]) > 0.0001f) return false;
        return true;
    }
    static void ReadOwnership() {
        Matrix current;
        if (warm && (!MagGetFullscreenColorEffect(out current) || !Same(current, applied))) warm=false;
    }
    static void SetWarm(bool enabled, int? strength=null, bool save=false) {
        int value=strength ?? warmStrength;
        if(value<0 || value>100) throw new ArgumentOutOfRangeException("strength","Warmth must be between 0 and 100");
        ReadOwnership();
        if (enabled && (!warm || value!=warmStrength)) {
            Matrix previous;
            if (!MagGetFullscreenColorEffect(out previous)) throw new Exception("Cannot read desktop color transform");
            if(!warm) original=previous;
            // Always derive from the captured baseline, never from the previous warmth level.
            var candidate=new Matrix { values=(float[])original.values.Clone() };
            // Preserve the existing lower half; extend the upper half to a deeper amber.
            float lower=Math.Min(value,50)/50f, upper=Math.Max(value-50,0)/50f;
            for(int row=0;row<5;row++) {
                candidate.values[row*5+1]*=1f-0.12f*lower-0.33f*upper;
                candidate.values[row*5+2]*=1f-0.30f*lower-0.62f*upper;
            }
            if (!MagSetFullscreenColorEffect(ref candidate)) throw new Exception("Desktop color transform is unavailable");
            Matrix check;
            if (!MagGetFullscreenColorEffect(out check) || !Same(check, candidate)) {
                MagSetFullscreenColorEffect(ref previous);
                throw new Exception("Desktop color transform readback did not match");
            }
            applied=candidate;
            warm=true;
        } else if(!enabled && warm) {
            if (!MagSetFullscreenColorEffect(ref original)) throw new Exception("Cannot restore desktop color transform");
            warm=false;
        }
        warmStrength=value;
        if(save) {
            Directory.CreateDirectory(Path.GetDirectoryName(warmthPath));
            File.WriteAllText(warmthPath,warmStrength.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
    }
    static bool IsDark() {
        using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
            return Convert.ToInt32(key == null ? 1 : key.GetValue("AppsUseLightTheme",1)) == 0;
    }
    static string SetIni(string text, string section, string key, string value) {
        var re=new Regex(@"(?im)^\["+Regex.Escape(section)+@"\][^\r\n]*\r?\n(?:(?!\[)[^\r\n]*\r?\n?)*");
        var match=re.Match(text);
        if(!match.Success) return text+"\r\n["+section+"]\r\n"+key+"="+value+"\r\n";
        string block=match.Value;
        var kv=new Regex(@"(?im)^"+Regex.Escape(key)+@"=[^\r\n]*");
        block=kv.IsMatch(block) ? kv.Replace(block,key+"="+value) : block.TrimEnd()+"\r\n"+key+"="+value+"\r\n";
        return text.Substring(0,match.Index)+block+text.Substring(match.Index+match.Length);
    }
    static void SetDark(bool enabled) {
        if(IsDark()==enabled) return;
        string current;
        using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes"))
            current=Convert.ToString(key == null ? null : key.GetValue("CurrentTheme"));
        if(string.IsNullOrEmpty(current) || !File.Exists(current)) throw new Exception("Current Windows theme file is unavailable");
        string text=File.ReadAllText(current,Encoding.Default);
        text=SetIni(text,"VisualStyles","SystemMode",enabled?"Dark":"Light");
        text=SetIni(text,"VisualStyles","AppMode",enabled?"Dark":"Light");
        text=SetIni(text,"Theme","DisplayName",enabled?"Fogline Dark":"Fogline Light");
        text=SetIni(text,"Theme","ThemeId",enabled?"{53BD1BC1-FA08-45F4-B210-817FD71C5700}":"{53BD1BC1-FA08-45F4-B210-817FD71C5701}");
        string themes=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Microsoft","Windows","Themes");
        Directory.CreateDirectory(themes);
        string path=Path.Combine(themes,enabled?"Fogline-dark.theme":"Fogline-light.theme");
        File.WriteAllText(path,text,Encoding.Unicode);
        object instance=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9324da94-50ec-4a14-a770-e90ca03e7c8f")));
        try {
            var manager=(IThemeManager2)instance;
            manager.Init(0);
            // Ignore wallpaper, cursors, desktop icons, sounds, screensaver; suppress hourglass.
            manager.AddAndSelectTheme(IntPtr.Zero,path,1|2|4|16|32|256,4);
        } finally { Marshal.ReleaseComObject(instance); }
        if(IsDark()!=enabled) throw new Exception("Windows theme manager did not apply the requested mode");
    }
    static string State() {
        ReadOwnership();
        return "{\"warm\":"+(warm?"true":"false")+",\"warmStrength\":"+warmStrength+",\"dark\":"+(IsDark()?"true":"false")+"}";
    }
    // ---- Wi-Fi through the Native Wifi API (wlanapi.dll), unchanged since Windows Vista. Seelen's own Wi-Fi module
    // fails to attach to some adapters (for instance MediaTek MT7925), so scanning and joining are done here instead.
    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint version,IntPtr reserved,out uint negotiated,out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr handle,IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr handle,IntPtr reserved,out IntPtr list);
    [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr handle,ref Guid iface,uint flags,IntPtr reserved,out IntPtr list);
    [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr handle,ref Guid iface,IntPtr ssid,IntPtr ie,IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr handle,ref Guid iface,IntPtr reserved);
    [DllImport("wlanapi.dll",CharSet=CharSet.Unicode)] static extern int WlanDeleteProfile(IntPtr handle,ref Guid iface,string name,IntPtr reserved);
    [DllImport("wlanapi.dll",CharSet=CharSet.Unicode)] static extern int WlanSetProfile(IntPtr handle,ref Guid iface,uint flags,string xml,string security,bool overwrite,IntPtr reserved,out uint reason);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WlanConnectParams { public int mode; public string profile; public IntPtr ssid; public IntPtr bssids; public int bssType; public uint flags; }
    [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr handle,ref Guid iface,ref WlanConnectParams parameters,IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);
    static string Q(string s) { return "\""+(s ?? "").Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r"," ").Replace("\n"," ")+"\""; }
    static string Param(string query,string key) {
        foreach(string pair in query.Split('&')) {
            int eq=pair.IndexOf('=');
            if(eq>0 && pair.Substring(0,eq)==key) return Uri.UnescapeDataString(pair.Substring(eq+1));
        }
        return null;
    }
    static IntPtr WlanOpen(out Guid iface) {
        uint version; IntPtr handle;
        if(WlanOpenHandle(2,IntPtr.Zero,out version,out handle)!=0) throw new Exception("The Wi-Fi service is not running");
        iface=Guid.Empty;
        IntPtr list;
        if(WlanEnumInterfaces(handle,IntPtr.Zero,out list)==0) {
            try {
                if(Marshal.ReadInt32(list)>0) { byte[] id=new byte[16]; Marshal.Copy(new IntPtr(list.ToInt64()+8),id,0,16); iface=new Guid(id); }
            } finally { WlanFreeMemory(list); }
        }
        if(iface==Guid.Empty) { WlanCloseHandle(handle,IntPtr.Zero); throw new Exception("No Wi-Fi adapter"); }
        return handle;
    }
    static string WlanAuth(int algorithm) {
        switch(algorithm) {
            case 1: return "open"; case 2: return "shared"; case 3: return "wpa-enterprise"; case 4: return "wpa-personal";
            case 6: return "wpa2-enterprise"; case 7: return "wpa2-personal"; case 8: case 11: return "wpa3-enterprise";
            case 9: return "wpa3-personal"; case 10: return "owe"; default: return "other";
        }
    }
    class WlanNet { public string ssid, profile, auth; public int signal; public bool secured, connected, known; }
    static System.Collections.Generic.List<WlanNet> WlanNetworks(IntPtr handle,Guid iface) {
        var result=new System.Collections.Generic.List<WlanNet>();
        IntPtr list;
        int code=WlanGetAvailableNetworkList(handle,ref iface,2,IntPtr.Zero,out list);
        if(code!=0) throw new Exception("Cannot read Wi-Fi networks ("+code+")");
        try {
            int count=Marshal.ReadInt32(list);
            for(int i=0;i<count;i++) {
                IntPtr entry=new IntPtr(list.ToInt64()+8+i*628);
                int length=Marshal.ReadInt32(entry,512);
                if(length<=0 || length>32) continue;
                byte[] name=new byte[length]; Marshal.Copy(new IntPtr(entry.ToInt64()+516),name,0,length);
                int flags=Marshal.ReadInt32(entry,620);
                var net=new WlanNet();
                net.ssid=Encoding.UTF8.GetString(name); net.profile=Marshal.PtrToStringUni(entry);
                net.signal=Marshal.ReadInt32(entry,604); net.secured=Marshal.ReadInt32(entry,608)!=0;
                net.auth=WlanAuth(Marshal.ReadInt32(entry,612)); net.connected=(flags&1)!=0; net.known=(flags&2)!=0;
                result.Add(net);
            }
        } finally { WlanFreeMemory(list); }
        return result;
    }
    static string WifiList() {
        Guid iface; IntPtr handle=WlanOpen(out iface);
        try {
            var json=new StringBuilder("{\"networks\":["); bool first=true;
            foreach(var net in WlanNetworks(handle,iface)) {
                if(!first) json.Append(","); first=false;
                json.Append("{\"ssid\":"+Q(net.ssid)+",\"signal\":"+net.signal+",\"secured\":"+(net.secured?"true":"false")+",\"auth\":"+Q(net.auth)+",\"connected\":"+(net.connected?"true":"false")+",\"known\":"+(net.known?"true":"false")+"}");
            }
            return json.Append("]}").ToString();
        } finally { WlanCloseHandle(handle,IntPtr.Zero); }
    }
    static string Xml(string s) { return System.Security.SecurityElement.Escape(s); }
    static string WifiProfile(string ssid,string auth,string password,bool hidden) {
        string security;
        if(auth=="open") security="<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>";
        else if(auth=="owe") security="<authEncryption><authentication>OWE</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>";
        else {
            if(string.IsNullOrEmpty(password)) throw new Exception("A password is required");
            string method=auth=="wpa3-personal" ? "WPA3SAE" : "WPA2PSK";
            security="<authEncryption><authentication>"+method+"</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>"
                +"<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>"+Xml(password)+"</keyMaterial></sharedKey>";
        }
        return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>"+Xml(ssid)+"</name>"
            +"<SSIDConfig><SSID><name>"+Xml(ssid)+"</name></SSID>"+(hidden?"<nonBroadcast>true</nonBroadcast>":"")+"</SSIDConfig>"
            +"<connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security>"+security+"</security></MSM></WLANProfile>";
    }
    static void WifiConnect(string ssid,string password,bool hidden) {
        Guid iface; IntPtr handle=WlanOpen(out iface);
        try {
            WlanNet found=null;
            foreach(var net in WlanNetworks(handle,iface)) if(net.ssid==ssid) { found=net; break; }
            string profile=found!=null && found.known ? found.profile : null;
            // a known network joins with its saved profile; a typed password replaces it (the old one may be stale)
            if(profile==null || !string.IsNullOrEmpty(password)) {
                string auth=found!=null ? found.auth : (string.IsNullOrEmpty(password) ? "open" : "wpa2-personal");
                if(auth.EndsWith("enterprise")) throw new Exception("This network signs in with an account or certificate; join it from the Windows network list");
                uint reason;
                int code=WlanSetProfile(handle,ref iface,2,WifiProfile(ssid,auth,password,hidden && found==null),null,true,IntPtr.Zero,out reason);
                if(code!=0) throw new Exception("Windows rejected the Wi-Fi profile ("+code+"/"+reason+")");
                profile=ssid;
            }
            var parameters=new WlanConnectParams(); parameters.mode=0; parameters.profile=profile; parameters.bssType=1;
            int result=WlanConnect(handle,ref iface,ref parameters,IntPtr.Zero);
            if(result!=0) throw new Exception("Could not start the connection ("+result+")");
        } finally { WlanCloseHandle(handle,IntPtr.Zero); }
    }
    static void WifiForget(string ssid) {
        Guid iface; IntPtr handle=WlanOpen(out iface);
        try {
            string profile=ssid;
            foreach(var net in WlanNetworks(handle,iface)) if(net.ssid==ssid && net.known) { profile=net.profile; break; }
            int code=WlanDeleteProfile(handle,ref iface,profile,IntPtr.Zero);
            if(code!=0 && code!=1168) throw new Exception("Could not remove the saved network ("+code+")");
        } finally { WlanCloseHandle(handle,IntPtr.Zero); }
    }
    static void WifiDisconnect() {
        Guid iface; IntPtr handle=WlanOpen(out iface);
        try { WlanDisconnect(handle,ref iface,IntPtr.Zero); } finally { WlanCloseHandle(handle,IntPtr.Zero); }
    }
    static void WifiScan() {
        Guid iface; IntPtr handle=WlanOpen(out iface);
        try { WlanScan(handle,ref iface,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero); } finally { WlanCloseHandle(handle,IntPtr.Zero); }
    }
    // ItemUrl is the real path (file:C:/Users/...); ItemPathDisplay is localised ("C:\使用者") and cannot be opened.
    static string RealPath(string url) {
        if(url==null || !url.StartsWith("file:",StringComparison.OrdinalIgnoreCase)) return url;
        return Uri.UnescapeDataString(url.Substring(5)).Replace('/','\\');
    }
    // Files from Windows' own search index (nothing of ours is built or kept): newest matches in the user's folders first.
    static string FileSearch(string text) {
        text=Regex.Replace(text ?? "","[%_\\[\\]']","").Trim();
        if(text.Length<2) return "{\"files\":[]}";
        var found=new StringBuilder();
        using(var connection=new System.Data.OleDb.OleDbConnection("Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\""))
        using(var command=connection.CreateCommand()) {
            connection.Open();
            command.CommandText="SELECT TOP 6 System.ItemNameDisplay, System.ItemUrl FROM SystemIndex WHERE System.ItemNameDisplay LIKE '%"+text+"%' AND System.ItemType <> '.lnk' AND NOT System.ItemPathDisplay LIKE '%\\AppData\\%' ORDER BY System.DateModified DESC";
            using(var reader=command.ExecuteReader())
                while(reader.Read()) {
                    if(found.Length>0) found.Append(',');
                    found.Append("{\"name\":").Append(Q(Convert.ToString(reader[0]))).Append(",\"path\":").Append(Q(RealPath(Convert.ToString(reader[1])))).Append('}');
                }
        }
        return "{\"files\":["+found+"]}";
    }    static string JsonError(string error) {
        return "{\"error\":\""+error.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r"," ").Replace("\n"," ")+"\"}";
    }
    [STAThread] static int Main(string[] args) {
        if(args.Length==1 && args[0]=="--warm-test") {
            if(!MagInitialize()) return 3;
            Matrix baseline; if(!MagGetFullscreenColorEffect(out baseline)) return 3;
            try {
                SetWarm(true,20); Matrix low=applied;
                SetWarm(true,80);
                if(Same(low,applied)) throw new Exception("Intensity did not change the matrix");
                SetWarm(true,100);
                for(int row=0;row<5;row++) {
                    if(Math.Abs(applied.values[row*5+1]-baseline.values[row*5+1]*.55f)>.0001f ||
                       Math.Abs(applied.values[row*5+2]-baseline.values[row*5+2]*.08f)>.0001f)
                        throw new Exception("Maximum warmth did not reach the extended amber range");
                }
                SetWarm(true,20);
                if(!Same(low,applied)) throw new Exception("Intensity compounded the previous transform");
                bool rejected=false;
                try { SetWarm(true,101); } catch(ArgumentOutOfRangeException) { rejected=true; }
                if(!rejected || !Same(low,applied)) throw new Exception("Out-of-range intensity was not rejected safely");
                SetWarm(false);
                Matrix restored; MagGetFullscreenColorEffect(out restored);
                if(!Same(baseline,restored)) throw new Exception("Original transform was not restored");
                Console.WriteLine("Intensity readback, non-compounding updates, bounds and original transform restoration verified");
                return 0;
            } catch(Exception e) { Console.WriteLine(e); return 1; }
            finally { ReadOwnership(); if(warm) SetWarm(false); MagUninitialize(); }
        }
        if(args.Length==1 && args[0]=="--http-test") {
            var probe=new TcpListener(IPAddress.Loopback,0); probe.Start();
            int testPort=((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
            string token=Guid.NewGuid().ToString("N");
            Exception failed=null;
            var test=new System.Threading.Thread(delegate() {
                Func<string,string,string,string> request=delegate(string path,string method,string auth) {
                    var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+testPort+path);
                    req.Proxy=null; req.Method=method; req.Timeout=3000;
                    if(method=="POST") req.ContentLength=0;
                    req.Headers["Authorization"]="Bearer "+auth;
                    using(var response=req.GetResponse()) using(var reader=new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
                };
                try {
                    bool ready=false;
                    for(int i=0;i<20;i++) {
                        try { request("/state","GET",token); ready=true; break; }
                        catch(WebException) { System.Threading.Thread.Sleep(25); }
                    }
                    if(!ready) throw new Exception("Bridge startup timeout");
                    try { request("/warm/on","POST","invalid"); throw new Exception("Authentication was bypassed"); }
                    catch(WebException e) { if(((HttpWebResponse)e.Response).StatusCode!=HttpStatusCode.Forbidden) throw; }
                    if(!request("/warm/on","POST",token).Contains("\"warm\":true")) throw new Exception("Warm-on readback failed");
                    if(!request("/warm/off","POST",token).Contains("\"warm\":false")) throw new Exception("Warm-off readback failed");
                    Console.WriteLine("HTTP authentication, warm-on, warm-off and readback verified");
                } catch(Exception e) { failed=e; }
                finally { try { request("/exit","POST",token); } catch {} }
            });
            test.Start();
            int result=Main(new string[]{testPort.ToString(),token});
            test.Join();
            if(failed!=null) { Console.WriteLine(failed); return 1; }
            return result;
        }
        if(args.Length==1 && args[0]=="--list-bars") {
            // diagnostics: which windows would be hidden for the monitor the Seelen bars are on
            uint seelen=SeelenProcess();
            EnumWindows(delegate(IntPtr window,IntPtr param) {
                IntPtr monitor=MonitorFromWindow(window,2);
                if(IsWindowVisible(window) && IsSeelenBar(window,seelen,monitor)) { NativeRect r; GetWindowRect(window,out r); Console.WriteLine("bar "+window.ToInt64().ToString("x")+" ["+r.left+","+r.top+","+r.right+","+r.bottom+"]"); }
                return true;
            },IntPtr.Zero);
            return 0;
        }
        if(args.Length==2 && args[0]=="--fs-test") {
            // diagnostics: is this window (hex handle) treated as fullscreen? If so hide the bars for two seconds, then restore them
            IntPtr window=new IntPtr(Convert.ToInt64(args[1],16)), monitor;
            bool full=IsFullscreenWindow(window,out monitor);
            Console.WriteLine("fullscreen="+full);
            if(full) { HideBars(monitor); Console.WriteLine("hidden "+hiddenBars.Count); Thread.Sleep(2000); RestoreBars(); Console.WriteLine("restored"); }
            return 0;
        }
        if(args.Length==1 && (args[0]=="--dark" || args[0]=="--light")) {
            SetDark(args[0]=="--dark"); return 0;
        }
        if(args.Length==1 && args[0]=="--self-test") {
            if(!MagInitialize()) { Console.WriteLine("MagInitialize failed"); return 3; }
            bool dark=IsDark();
            try {
                var clock=System.Diagnostics.Stopwatch.StartNew();
                SetWarm(true); Console.WriteLine("warm-on verified: "+clock.ElapsedMilliseconds+"ms");
                SetWarm(false); Console.WriteLine("warm-off verified: "+clock.ElapsedMilliseconds+"ms total");
                clock.Restart(); SetDark(!dark);
                Console.WriteLine("theme switch verified: "+clock.ElapsedMilliseconds+"ms");
                SetDark(dark); Console.WriteLine("original theme mode restored");
                return 0;
            } catch(Exception e) { Console.WriteLine(e.ToString()); return 1; }
            finally { ReadOwnership(); if(warm) SetWarm(false); if(IsDark()!=dark) SetDark(dark); MagUninitialize(); }
        }
        if(args.Length!=2) return 2;
        int port;
        if(!int.TryParse(args[0],out port) || args[1].Length<32) return 2;
        if(!MagInitialize()) return 3;
        var listener=new TcpListener(IPAddress.Loopback,port);
        Thread inputTracker=StartInputTracking();
        try {
            listener.Start();
            bool exit=false;
            while(!exit) using(var client=listener.AcceptTcpClient()) {
                client.ReceiveTimeout=2000; client.SendTimeout=2000;
                try {
                    using(var stream=client.GetStream()) {
                        var header=new StringBuilder();
                        while(header.Length<8192) {
                            int b=stream.ReadByte(); if(b<0) break;
                            header.Append((char)b);
                            if(header.ToString().EndsWith("\r\n\r\n",StringComparison.Ordinal)) break;
                        }
                        string request=header.ToString();
                        string[] line=request.Split('\n')[0].Trim().Split(' ');
                        string query="";
                        if(line.Length>=2) { int mark=line[1].IndexOf('?'); if(mark>=0) { query=line[1].Substring(mark+1); line[1]=line[1].Substring(0,mark); } }
                        int status=200; string body;
                        if(line.Length<2) { status=400; body=JsonError("Invalid request"); }
                        else if(line[0]=="OPTIONS") body="{}";
                        else if(request.IndexOf("\r\nAuthorization: Bearer "+args[1]+"\r\n",StringComparison.OrdinalIgnoreCase)<0) {
                            status=403; body=JsonError("Unauthorized");
                        } else try {
                            string inputResult=null;
                            if(line[0]=="GET" && line[1]=="/state") {}
                            else if(line[0]=="GET" && line[1]=="/ime/state") inputResult=InputState(null);
                            else if(line[0]=="POST" && line[1]=="/ime/native") inputResult=InputState(true);
                            else if(line[0]=="POST" && line[1]=="/ime/direct") inputResult=InputState(false);
                            else if(line[0]=="POST" && line[1]=="/ime/full") inputResult=InputState(null,true);
                            else if(line[0]=="POST" && line[1]=="/ime/half") inputResult=InputState(null,false);
                            else if(line[0]=="POST" && line[1]=="/ime/language-bar") { ShowLanguageBar(); inputResult="{}"; }
                            else if(line[0]=="GET" && line[1]=="/wifi/list") inputResult=WifiList();
                            else if(line[0]=="POST" && line[1]=="/wifi/scan") { WifiScan(); inputResult="{}"; }
                            else if(line[0]=="POST" && line[1]=="/wifi/connect") { string target=Param(query,"ssid"); if(string.IsNullOrEmpty(target)) throw new Exception("Network name is required"); WifiConnect(target,Param(query,"password"),Param(query,"hidden")=="1"); inputResult="{}"; }
                            else if(line[0]=="POST" && line[1]=="/wifi/forget") { string target=Param(query,"ssid"); if(string.IsNullOrEmpty(target)) throw new Exception("Network name is required"); WifiForget(target); inputResult="{}"; }
                            else if(line[0]=="POST" && line[1]=="/wifi/disconnect") { WifiDisconnect(); inputResult="{}"; }
                            else if(line[0]=="GET" && line[1]=="/files") inputResult=FileSearch(Param(query,"q"));
                            else if(line[0]=="GET" && line[1]=="/dnd") inputResult="{\"dnd\":"+(Dnd.Read()?"true":"false")+"}";
                            else if(line[0]=="POST" && line[1]=="/notifications/open") { WindowsNotifications.Open(); inputResult="{}"; }
                            else if(line[0]=="POST" && (line[1]=="/dnd/on" || line[1]=="/dnd/off")) { bool want=line[1]=="/dnd/on"; Dnd.Set(want); inputResult="{\"dnd\":"+(want?"true":"false")+"}"; }
                            else if(line[0]=="POST" && line[1]=="/warm/on") SetWarm(true);
                            else if(line[0]=="POST" && line[1]=="/warm/off") SetWarm(false);
                            else if(line[0]=="POST" && line[1]=="/warm/strength") {
                                int value;
                                if(!int.TryParse(Param(query,"value"),out value)) throw new ArgumentException("Invalid warmth value");
                                SetWarm(warm,value,Param(query,"save")=="1");
                            }
                            else if(line[0]=="POST" && line[1]=="/theme/dark") SetDark(true);
                            else if(line[0]=="POST" && line[1]=="/theme/light") SetDark(false);
                            else if(line[0]=="POST" && line[1]=="/exit") { SetWarm(false); exit=true; }
                            else throw new Exception("Unknown command");
                            body=inputResult ?? State();
                        } catch(Exception e) { status=500; body=JsonError(e.Message); }
                        byte[] payload=Encoding.UTF8.GetBytes(body);
                        byte[] response=Encoding.ASCII.GetBytes("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nContent-Length: "+payload.Length+"\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization\r\n\r\n");
                        stream.Write(response,0,response.Length); stream.Write(payload,0,payload.Length);
                    }
                } catch(IOException) {} // Bound slow/malformed clients; continue serving legitimate commands.
            }
        } catch(SocketException) { return 4; }
        finally {
            ReadOwnership(); if(warm) MagSetFullscreenColorEffect(ref original);
            listener.Stop(); MagUninitialize();
            if(inputThread!=0) PostThreadMessage(inputThread,0x12,UIntPtr.Zero,IntPtr.Zero);
            inputTracker.Join(500);
        }
        return 0;
    }
}

// Direct Shell COM calls: no synthetic hotkeys and no Settings windows.
// These interfaces are undocumented and may change with Windows releases.
internal static class WindowsNotifications {
    [ComImport,Guid("6D5140C1-7436-11CE-8034-00AA006009FA"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IServiceProvider {
        [PreserveSig] int QueryService(ref Guid service,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out object result);
    }
    [ComImport,Guid("2E8FCB18-A0EE-41AD-8EF8-77FB3A370CA5"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IExperienceFactory {
        void GetIids(out uint count,out IntPtr ids);
        void GetRuntimeClassName(out IntPtr name);
        void GetTrustLevel(out int level);
        [return:MarshalAs(UnmanagedType.Interface)] object GetExperienceManager(IntPtr name);
    }
    [ComImport,Guid("DEC04B18-357E-41D8-9B71-B991243BEA34"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActionCenter {
        void GetIids(out uint count,out IntPtr ids);
        void GetRuntimeClassName(out IntPtr name);
        void GetTrustLevel(out int level);
        void HotKeyInvoked(IntPtr kind);
    }
    [DllImport("combase.dll",CharSet=CharSet.Unicode)] static extern int WindowsCreateString(string value,int length,out IntPtr result);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr value);
    public static void Open() {
        object shell=null,factory=null,manager=null; IntPtr name=IntPtr.Zero;
        try {
            shell=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239")));
            Guid service=new Guid("2E8FCB18-A0EE-41AD-8EF8-77FB3A370CA5"),iid=service;
            Marshal.ThrowExceptionForHR(((IServiceProvider)shell).QueryService(ref service,ref iid,out factory));
            const string experience="Windows.Internal.ShellExperience.ActionCenter";
            Marshal.ThrowExceptionForHR(WindowsCreateString(experience,experience.Length,out name));
            manager=((IExperienceFactory)factory).GetExperienceManager(name);
            ((IActionCenter)manager).HotKeyInvoked(IntPtr.Zero);
        } finally {
            if(manager!=null) Marshal.ReleaseComObject(manager);
            if(name!=IntPtr.Zero) WindowsDeleteString(name);
            if(factory!=null) Marshal.ReleaseComObject(factory);
            if(shell!=null) Marshal.ReleaseComObject(shell);
        }
    }
}

internal static class Dnd {
    // IQuietHoursSettings ABI: Rafael Rivera, MIT; see THIRD-PARTY.txt.
    [ComImport,Guid("F53321FA-34F8-4B7F-B9A3-361877CB94CF")] class QuietSettings {}
    [ComImport,Guid("6BFF4732-81EC-4FFB-AE67-B6C1BC29631F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IQuietSettings {
        string UserSelectedProfile { [return:MarshalAs(UnmanagedType.LPWStr)] get; [param:MarshalAs(UnmanagedType.LPWStr)] set; }
        IntPtr GetProfile([MarshalAs(UnmanagedType.LPWStr)] string profile);
        void GetAllProfileData();
        [return:MarshalAs(UnmanagedType.LPWStr)] string GetDisplayNameForProfile([MarshalAs(UnmanagedType.LPWStr)] string profile);
        IntPtr QuietMomentsManager { get; }
        string OffProfileId { [return:MarshalAs(UnmanagedType.LPWStr)] get; }
        string ActiveQuietMomentProfile { [return:MarshalAs(UnmanagedType.LPWStr)] get; [param:MarshalAs(UnmanagedType.LPWStr)] set; }
        string ActiveProfile { [return:MarshalAs(UnmanagedType.LPWStr)] get; }
    }
    static bool IsOn(IQuietSettings settings) {
        string active=settings.ActiveProfile,off=settings.OffProfileId;
        if(string.IsNullOrEmpty(active) || string.IsNullOrEmpty(off)) throw new Exception("Windows did not report the active Do Not Disturb profile");
        return !string.Equals(active,off,StringComparison.Ordinal);
    }
    public static bool Read() {
        object instance=new QuietSettings();
        try { return IsOn((IQuietSettings)instance); }
        finally { Marshal.ReleaseComObject(instance); }
    }
    public static void Set(bool on) {
        object instance=new QuietSettings();
        try {
            var settings=(IQuietSettings)instance;
            string original=settings.UserSelectedProfile;
            try {
                settings.UserSelectedProfile=on ? "Microsoft.QuietHoursProfile.PriorityOnly" : settings.OffProfileId;
                for(int i=0;i<12;i++) {
                    if(IsOn(settings)==on) return;
                    Thread.Sleep(50);
                }
                throw new Exception("Windows did not apply Do Not Disturb; an automatic rule may be overriding it");
            } catch {
                settings.UserSelectedProfile=original;
                throw;
            }
        } finally { Marshal.ReleaseComObject(instance); }
    }
}
