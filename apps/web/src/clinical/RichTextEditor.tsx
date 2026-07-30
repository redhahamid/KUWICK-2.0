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
}

const FONT_FAMILIES = ['Sans Serif', 'Serif', 'Monospace'];

export function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
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
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 6 }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
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
      <EditorContent editor={editor} style={{ padding: 12, minHeight: 240 }} />
    </div>
  );
}
