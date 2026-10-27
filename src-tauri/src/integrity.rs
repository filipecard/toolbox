//! Cheap tamper checks for release builds. None of this is unbreakable —
//! code running on the user's machine can always be patched — but together
//! with the server-side rules (signed plan bound to this computer, usage
//! counted per account, device limits) it raises the effort well above
//! "edit a file" or "attach a debugger and flip a flag".

/// A debugger attached to a release build is a strong sign of someone
/// stepping through the plan checks: paid features fall back to Grátis.
/// Debug builds are exempt (that's how we develop).
pub fn debugger_attached() -> bool {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn IsDebuggerPresent() -> i32;
        }
        // SAFETY: no arguments, no side effects; documented as always safe.
        unsafe { IsDebuggerPresent() != 0 }
    }
    #[cfg(not(all(windows, not(debug_assertions))))]
    {
        false
    }
}
