# Frontend Rules

This document defines rules for the Next.js frontend in `frontend/`.

## Example Folder Structure

Note: the structure below is an example for a hypothetical blog or shop website. Use it as a pattern for separation of concerns, not as a strict requirement to keep the exact same route names.

```text
frontend/
├── app/
│   ├── (site)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── about/
│   │   │   └── page.tsx
│   │   ├── contact/
│   │   │   └── page.tsx
│   │   └── blog/
│   │       ├── page.tsx
│   │       └── [slug]/
│   │           └── page.tsx
│   │
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── users/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   │       └── page.tsx
│   │   ├── products/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   └── [id]/
│   │   │       └── page.tsx
│   │   └── settings/
│   │       └── page.tsx
│   │
│   ├── login/
│   │   └── page.tsx
│   │
│   └── utilities/
│       └── api.ts
│
├── components/
│   ├── site/
│   │   ├── header.tsx
│   │   ├── footer.tsx
│   │   ├── hero.tsx
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   └── modal.tsx
│   └── admin/
│       ├── sidebar.tsx
│       ├── navbar.tsx
│       ├── table.tsx
│       ├── button.tsx
│       ├── input.tsx
│       └── modal.tsx
```

## Routing Folder Rules

- In `app/(site)/` and `app/admin/`, only Next.js route files are allowed.
- Allowed route files include `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and other Next.js route-specific files.
- Do not place reusable components, custom helpers, or service files inside route folders.

## API and Service Rules

- Only `page.tsx` files are allowed to call services/APIs.
- `app/utilities/api.ts` must contain only general request helpers (for example: `get`, `post`).
- Do not add endpoint-specific API functions in `app/utilities/api.ts`.
- Endpoint-specific API calls should be written directly in `page.tsx` files using helpers from `app/utilities/api.ts`.
- Components should not call APIs directly unless absolutely necessary.

## Component Placement Rules

- Put site reusable UI in `components/site/`.
- Put admin reusable UI in `components/admin/`.
- Keep components presentational and pass data through props whenever possible.

## UX Design Rules

- Prioritize primary user goals on each page and keep secondary actions visually de-emphasized.
- Use progressive disclosure: show advanced or less-frequent actions only when needed.
- Keep high-traffic pages focused on scanability with clear visual hierarchy (headline, key actions, core content).
- Prefer contextual overlays (modal/drawer/popover) for short create/edit flows when users should stay in page context.
- Place primary actions in predictable locations and keep button labels action-oriented and unambiguous.
- Keep forms concise: ask only required fields first, group related inputs, and use helpful defaults.
- Provide immediate feedback for async actions (loading, success, error) and never leave users in uncertain states.
- Design for responsive behavior from mobile to desktop, preserving action priority and readability at every breakpoint.
- Maintain accessibility baseline: keyboard operability, visible focus states, semantic landmarks, and sufficient color contrast.
- Avoid layout shifts and unexpected navigation; user context should remain stable after common actions.

## Quick Check

- [ ] `app/(site)/` and `app/admin/` contain only Next.js route files
- [ ] Only `page.tsx` files call services/APIs
- [ ] `app/utilities/api.ts` has only general helpers (like `get`, `post`)
- [ ] Reusable UI is in `components/site/` or `components/admin/`
- [ ] Each page keeps primary goals prominent and secondary flows progressively disclosed
- [ ] Forms, feedback states, responsiveness, and accessibility baseline are addressed
