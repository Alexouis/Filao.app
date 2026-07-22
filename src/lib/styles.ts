/**
 * Shared style constants for glass-morphism UI.
 * Single source of truth — import this instead of redefining locally.
 */

/** Standard glass card used as the main container in page-level views */
export const GLASS_STYLE =
    "bg-gradient-to-br from-white/40 via-white/20 to-white/5 backdrop-blur-3xl border border-white/80 shadow-[0_8px_32px_0_rgba(31,38,135,0.1),inset_0_1px_0_0_rgba(255,255,255,0.5)]";

/** Glass card with hover shadow, used for interactive stat tiles */
export const GLASS_TILE_STYLE =
    "bg-gradient-to-br from-white/40 via-white/20 to-white/5 backdrop-blur-3xl border border-white/80 shadow-[0_8px_8px_0_rgba(31,38,135,0.1),inset_0_1px_0_0_rgba(255,255,255,0.5)] relative overflow-hidden group hover:shadow-[0_8px_8px_0_rgba(31,38,135,0.2)] transition-all duration-500";

/** Lighter glass for modals and picker overlays */
export const GLASS_MODAL_STYLE =
    "bg-white/60 backdrop-blur-3xl border border-white/80 shadow-[0_8px_32px_0_rgba(31,38,135,0.1)] relative overflow-hidden transition-all duration-500 rounded-3xl";
