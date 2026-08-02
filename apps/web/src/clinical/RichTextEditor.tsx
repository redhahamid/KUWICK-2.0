import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Link from '@tiptap/extension-link';
import ImageExtension from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import { Button, ColorPicker, Select, Space } from 'antd';
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ClearOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

// Pulled forward from the Documents phase (D-026, docs/DECISIONS.md) into
// Clinical Notes — the audited kuwick.com Clinical Notes tab uses a full
// rich-text editor, not a plain textarea (Clinical fidelity pass). The
// Documents phase (Phase 4) reuses this same component.
interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  // Canvas layout needs the whole record visible without page scroll
  // (user feedback) — compact gives the editor a short, internally-
  // scrollable content area instead of a tall fixed minHeight.
  compact?: boolean;
  // C2 — the editor should claim all remaining height in the Canvas
  // workspace rather than being a fixed short box.
  fill?: boolean;
  // G0a (D-054) — false for a signed, legacy or permission-locked note.
  // Until now the caller only swallowed onChange, which left .ProseMirror
  // contenteditable: a doctor could type into a SIGNED note and the text
  // stayed on screen unsaved, looking like an accepted edit to a sealed
  // medicolegal record. Found by prisma/g0a-editor-check.ts.
  editable?: boolean;
}

const FONT_FAMILIES = ['Sans Serif', 'Serif', 'Monospace'];

export function RichTextEditor({
  content,
  onChange,
  placeholder,
  compact,
  fill,
  editable = true,
}: RichTextEditorProps) {
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      ImageExtension,
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder: placeholder ?? 'Clinical notes...' }),
    ],
    content,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Selecting a signed note after editing a draft must lock the editor, not
  // leave the previous note's editable state behind.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  const addLink = () => {
    const url = window.prompt('URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt('Image URL');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    // G0a (D-054) — `fill` no longer means "absorb the leftover height of a
    // viewport-sized shell". It selects the desktop editor height, which is
    // declared in CSS (.kw-editor-fill), so lower clinical sections can grow
    // without ever shrinking the doctor's typing area.
    <div style={compact ? undefined : { border: '1px solid #d9d9d9', borderRadius: 6 }}>
      <div style={{ padding: compact ? 4 : 8, borderBottom: '1px solid #f0f0f0' }}>
        <Space wrap size={4}>
          <Button
            size="small"
            type={editor.isActive('bold') ? 'primary' : 'default'}
            icon={<BoldOutlined />}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <Button
            size="small"
            type={editor.isActive('italic') ? 'primary' : 'default'}
            icon={<ItalicOutlined />}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <Button
            size="small"
            type={editor.isActive('underline') ? 'primary' : 'default'}
            icon={<UnderlineOutlined />}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <Button
            size="small"
            type={editor.isActive('strike') ? 'primary' : 'default'}
            icon={<StrikethroughOutlined />}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <Button
            size="small"
            type={editor.isActive('heading', { level: 1 }) ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            H1
          </Button>
          <Button
            size="small"
            type={editor.isActive('heading', { level: 2 }) ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </Button>
          <Button
            size="small"
            type={editor.isActive('bulletList') ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <Button
            size="small"
            type={editor.isActive('orderedList') ? 'primary' : 'default'}
            icon={<OrderedListOutlined />}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <Button
            size="small"
            type={editor.isActive('subscript') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
          >
            x₂
          </Button>
          <Button
            size="small"
            type={editor.isActive('superscript') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
          >
            x²
          </Button>
        </Space>
      </div>
      {!compact && (
        <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
          <Space wrap size={4}>
            <Select
              size="small"
              style={{ width: 130 }}
              placeholder="Font"
              options={FONT_FAMILIES.map((font) => ({ value: font, label: font }))}
              onChange={(font) => editor.chain().focus().setFontFamily(font).run()}
            />
            <ColorPicker
              size="small"
              onChange={(color) => editor.chain().focus().setColor(color.toHexString()).run()}
            />
            <Button
              size="small"
              type={editor.isActive({ textAlign: 'left' }) ? 'primary' : 'default'}
              icon={<AlignLeftOutlined />}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
            />
            <Button
              size="small"
              type={editor.isActive({ textAlign: 'center' }) ? 'primary' : 'default'}
              icon={<AlignCenterOutlined />}
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
            />
            <Button
              size="small"
              type={editor.isActive({ textAlign: 'right' }) ? 'primary' : 'default'}
              icon={<AlignRightOutlined />}
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
            />
            <Button size="small" icon={<LinkOutlined />} onClick={addLink} />
            <Button size="small" icon={<PictureOutlined />} onClick={addImage} />
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            />
          </Space>
        </div>
      )}
      <EditorContent
        editor={editor}
        className={
          [compact ? 'kw-notes-borderless' : '', fill ? 'kw-editor-fill' : 'kw-editor-min']
            .filter(Boolean)
            .join(' ') || undefined
        }
        style={
          fill
            ? // The .ProseMirror inside scrolls only once the doctor's own
              // text outgrows the declared height — a scrollbar they caused,
              // not one the layout imposed.
              { padding: 8 }
            : compact
              ? { padding: 6, minHeight: 100 }
              : { padding: 12, minHeight: 240 }
        }
      />
    </div>
  );
}
