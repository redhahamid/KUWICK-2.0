import { Select } from 'antd';
import { useReferenceCatalog } from '../clinical/hooks/useReferenceCatalogs';

/**
 * INDICATION — the clinic's own list, as tags, stored as text.
 *
 * `Item.indication` is a string and stays one, and that is a deliberate limit
 * rather than an oversight. A prescription COPIES the indication at
 * prescribe-time (historical stability — `Prescription.indication` is its own
 * free-text column), so turning the item's field into a reference would mean
 * turning the prescription's into one too, and back-filling every prescription
 * ever written. That is a bigger change than a form field, and it belongs with
 * whoever takes on the 1F columns' last reader.
 *
 * What this DOES fix: the box offered no help at all, so every clinic invented
 * their own spelling of "hypertension" and the presets nobody could reach went
 * unused. The catalogue's labels are offered; a typed one is still accepted,
 * because refusing would make the field unusable for anything the list has not
 * caught up with yet.
 *
 * THE KNOWN LIMIT, stated: renaming a preset in Settings does NOT rewrite the
 * items that copied its label. Same trade-off the free-text dosage trio
 * carries, and the same reason — the readers downstream hold text.
 */
export function IndicationTags(props: { value?: string; onChange?: (value: string | undefined) => void }) {
  const { data: indications } = useReferenceCatalog('indications');

  const tags = props.value
    ? props.value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  return (
    <Select
      allowClear
      mode="tags"
      placeholder="What this medicine is for — pick from the list, or type your own"
      options={(indications ?? []).map((row) => ({
        value: row.labelEn,
        // Bilingual, like every other picker fed by this catalogue.
        label: `${row.labelEn} / ${row.labelBm}`,
      }))}
      value={tags}
      // Joined with ", " on the way out — the column is text, and the
      // prescription that copies it renders that text as-is.
      onChange={(next: string[]) => {
        const cleaned = next.map((tag) => tag.trim()).filter(Boolean);
        props.onChange?.(cleaned.length ? cleaned.join(', ') : undefined);
      }}
    />
  );
}
