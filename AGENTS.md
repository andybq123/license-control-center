<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- `sistema-licencas/` is a standalone Node.js license server (self-hosted on a VPS via Docker + Caddy); it is excluded from lint and is not part of the Vite app.
- The VPS admin panel uses its own semantic tokens in `server/public/panel.css` and a single vanilla-JS dashboard; keep it separate from the TanStack host because Express APIs are served by the VPS.
- License polling uses a capped interval, success and failure callbacks, and keeps the last state on network errors; enforcement must also be installed in the licensed application.
