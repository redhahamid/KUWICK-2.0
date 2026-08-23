# Patient booking — acceptance pack

Captured from the built app by `shots-booking.mjs` at the repository root
against the local stack with the pre-merge QA seed loaded. Re-runnable:

```
node shots-booking.mjs
```

The clinic is **Klinik Hijraa Bangi**. GP Consultation has six qualified
doctors; Density Follow-up Review has exactly one — which is what makes both
paths capturable in one pass.

Phone shots are 390 × 844 (iPhone 14/15 class, ×2). Desktop is 1440 × 900.

| Shot | Surface | What it is evidence of |
| --- | --- | --- |
| `m1-service` | Service list | 235px of chrome before the first card, down from ~360px. Descriptions clamped to two lines; the full text is behind the `i`. One affordance per right edge — the price, with the decorative arrow gone. |
| `m2-doctor` | Doctor list | Six providers in roughly one fold. No repeated "Doctor" caption, no "NEXT AVAILABLE" column header printed once per row, and no fastest-appointment banner restating the tile directly beneath it. |
| `m3-date` | Date | Leading weeks that have wholly passed are dropped, and said so. The legend sits above the grid it explains. The chosen doctor is named once, in the context card — the fastest line no longer repeats them. |
| `m4-time` | Time, with 09:45 chosen | The action bar is pinned to the bottom, so the button that accepts the chosen time is under the thumb rather than below the whole slot list. The card above it stays as the confirmation, naming the real doctor. |
| `m5-details` | Details, filled | The green "success" alert is now the same context card the other steps use, and it carries the Change time this step never had. |
| `m6-review` | Review | Every fact restated before anything is booked, with the honest payment line: the clinic collects on arrival. |
| `m7-confirmed` | Confirmation | The wallet card, no longer 32px wider than the phone. Booking reference, QR, and the private manage link. |
| `m8-manage` | Manage | What a patient sees on the token link: their appointment, the change window, and the two things they may do. |
| `m9-reschedule` | Reschedule | The SAME availability month, reused not rebuilt — with the current appointment ringed and named in the legend. |
| `m10-sole-provider-skips-to-date` | Skip proof | One tap on a single-provider service lands on step 3 of 6 with that provider chosen. This is the QA density fixture, so its doctor carries the seed's deliberate "(Synthetic)" marker — a safety convention in the seeds, not something a clinic would ever show. |
| `d1-service` / `d2-doctor` / `d3-review` | Desktop | The six-circle stepper returns above 560px; the phone's single progress line and the circle row are never both on screen. |

## Not shown, deliberately

* **No ratings.** Kuwick has no patient review system; a seeded score is a
  lie a patient acts on.
* **No photographs of people.** Nothing in Kuwick stores staff or patient
  photographs, so the avatars are monograms and no stock face stands in.
  Service photos appear only where a clinic genuinely uploaded one.
