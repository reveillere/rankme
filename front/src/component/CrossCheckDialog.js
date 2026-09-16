import { IdentityLinkDialog } from './IdentityLinkDialog';

// Lets a DBLP author page pick which HAL identity to cross-check against --
// the 'hal' direction of IdentityLinkDialog (see that file for why the
// HAL-search and DBLP-search dialogs are now one component parameterized by
// direction). Kept as its own named wrapper (rather than Author.js inlining
// `direction="hal"` itself) purely so its title/description text lives in
// one place -- unlike the DBLP-direction call sites (CrossCheckStructure.js,
// AuthorHal.js, CrossCheckTeam.js's hal-sourced flow), which each interpolate
// their own already-known member name into the description and so use
// IdentityLinkDialog directly instead.
export function CrossCheckDialog({ open, onClose, onConfirm, suggestion }) {
    return (
        <IdentityLinkDialog
            open={open}
            onClose={onClose}
            onConfirm={onConfirm}
            direction="hal"
            title="Cross-check with HAL"
            description="Find this author's HAL identity to list DBLP publications with no matching HAL deposit."
            suggestion={suggestion}
        />
    );
}
