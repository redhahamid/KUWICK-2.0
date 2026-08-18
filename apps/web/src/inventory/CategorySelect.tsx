import { Select } from 'antd';
import { useItemCategories } from './hooks/useItemCatalogue';

/**
 * The category field: the clinic's own list, and still a text box.
 *
 * `mode="tags"` rather than a plain Select, because `Item.category` is a
 * STRING and stays the truth on the row — the registry is a list of names, not
 * a set of ids. Someone filing a medicine under a section they have not created
 * yet gets to type it; it appears as a tab immediately (the tabs union in-use
 * strings) and can be adopted into the list from Manage Categories.
 *
 * Refusing an unlisted name would be a screen enforcing a rule the data model
 * does not have, and the first thing it would break is the import.
 */
export function CategorySelect(props: { value?: string; onChange?: (value: string | undefined) => void }) {
  const { data: categories } = useItemCategories();

  return (
    <Select
      allowClear
      mode="tags"
      maxCount={1}
      placeholder="Pick one, or type a new one"
      options={(categories ?? []).map((category) => ({ value: category.name, label: category.name }))}
      value={props.value ? [props.value] : []}
      onChange={(next: string[]) => props.onChange?.(next[next.length - 1]?.trim() || undefined)}
    />
  );
}
