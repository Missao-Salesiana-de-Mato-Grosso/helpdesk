import { Input } from '@mantine/core';
import { Link, RichTextEditor, type RichTextEditorLabels } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useId } from 'react';

const LABELS: Partial<RichTextEditorLabels> = {
  boldControlLabel: 'Negrito',
  italicControlLabel: 'Itálico',
  underlineControlLabel: 'Sublinhado',
  strikeControlLabel: 'Tachado',
  bulletListControlLabel: 'Lista com marcadores',
  orderedListControlLabel: 'Lista numerada',
  blockquoteControlLabel: 'Citação',
  codeControlLabel: 'Código',
  linkControlLabel: 'Inserir link',
  unlinkControlLabel: 'Remover link',
  undoControlLabel: 'Desfazer',
  redoControlLabel: 'Refazer',
  linkEditorInputLabel: 'Endereço do link',
  linkEditorInputPlaceholder: 'https://exemplo.com/',
  linkEditorExternalLink: 'Abrir em nova aba',
  linkEditorInternalLink: 'Abrir na mesma aba',
  linkEditorSave: 'Salvar',
};

export interface HtmlEditorProps {
  label: string;
  /** HTML; `''` quando o editor está vazio (só espaços também conta como vazio). */
  value: string;
  onChange: (html: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}

/**
 * Editor rico (Tiptap via `@mantine/tiptap`) com o subconjunto que a allowlist do backend aceita:
 * negrito, itálico, sublinhado, tachado, listas, citação, código e link. Sem imagens (anexos: T13).
 */
export function HtmlEditor({ label, value, onChange, error, disabled = false }: HtmlEditorProps) {
  // O Input.Wrapper do Mantine dá ao rótulo o id `<id>-label`.
  const labelId = useId();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({ openOnClick: false }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': `${labelId}-label`,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getText().trim() === '' ? '' : current.getHTML());
    },
  });

  // O pai limpa o campo (ex.: depois de enviar) passando `value = ''`.
  useEffect(() => {
    if (editor && value === '' && editor.getText().trim() !== '') editor.commands.clearContent();
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <Input.Wrapper label={label} id={labelId} required error={error}>
      <RichTextEditor editor={editor} labels={LABELS} mt={4}>
        <RichTextEditor.Toolbar>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Underline />
            <RichTextEditor.Strikethrough />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.Blockquote />
            <RichTextEditor.Code />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Link />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content mih={160} />
      </RichTextEditor>
    </Input.Wrapper>
  );
}
