import { Input, Text } from '@mantine/core';
import { Link, RichTextEditor, type RichTextEditorLabels } from '@mantine/tiptap';
import Image from '@tiptap/extension-image';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  imageCountIn,
  withExtension,
  type InlineImageStore,
} from '../features/attachments/inline-images.ts';

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

/** Ações do editor para o pai (ex.: inserir uma resposta pronta, T26). */
export interface HtmlEditorHandle {
  /** Insere o HTML na posição do cursor (no fim, se o editor nunca recebeu foco). */
  insertHtml: (html: string) => void;
}

export interface HtmlEditorProps {
  label: string;
  /** HTML; `''` quando o editor está vazio (só espaços também conta como vazio). */
  value: string;
  onChange: (html: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** Marca o campo como obrigatório no rótulo. A assinatura (T31) é opcional. */
  required?: boolean;
  handleRef?: Ref<HtmlEditorHandle>;
  /**
   * T32: liga as imagens no texto (botão, colar e arrastar), guardadas nesta store até o envio.
   * Sem ela, o editor não aceita imagens (respostas prontas, assinatura).
   */
  images?: InlineImageStore | undefined;
}

/**
 * Imagem do texto (T32): a prévia usa `blob:` e a chave vai em `data-inline-key`, que o servidor
 * troca pelo id do anexo. `data:` (base64) não entra. Na assinatura (T33), a imagem já salva
 * mantém o `data-signature-image-id`.
 */
const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      inlineKey: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-inline-key'),
        renderHTML: (attributes) =>
          typeof attributes['inlineKey'] === 'string'
            ? { 'data-inline-key': attributes['inlineKey'] }
            : {},
      },
      signatureImageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-signature-image-id'),
        renderHTML: (attributes) =>
          typeof attributes['signatureImageId'] === 'string'
            ? { 'data-signature-image-id': attributes['signatureImageId'] }
            : {},
      },
    };
  },
}).configure({ inline: true, allowBase64: false });

const hasImage = (html: string) => /<img\s/i.test(html);
const imageFiles = (list: FileList | null | undefined) =>
  [...(list ?? [])].filter((file) => file.type.startsWith('image/'));

/**
 * Editor rico (Tiptap via `@mantine/tiptap`) com o subconjunto que a allowlist do backend aceita:
 * negrito, itálico, sublinhado, tachado, listas, citação, código e link. Imagens no texto só com
 * `images` (T32); os demais arquivos vão como anexos (T13).
 */
export function HtmlEditor({
  label,
  value,
  onChange,
  error,
  disabled = false,
  required = true,
  handleRef,
  images,
}: HtmlEditorProps) {
  // O Input.Wrapper do Mantine dá ao rótulo o id `<id>-label`.
  const labelId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Colar e arrastar chegam pelo ProseMirror, que guarda os handlers da criação do editor.
  const insertImages = useRef<(files: File[]) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({ openOnClick: false }),
      ...(images ? [InlineImage] : []),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': `${labelId}-label`,
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!images || files.length === 0) return false;
        insertImages.current(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (!images || moved || files.length === 0) return false;
        event.preventDefault();
        insertImages.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      onChange(current.getText().trim() === '' && !hasImage(html) ? '' : html);
    },
  });

  useEffect(() => {
    insertImages.current = (files) => {
      if (!editor || !images) return;
      let count = imageCountIn(editor.getHTML());
      const errors: string[] = [];
      for (const picked of files) {
        const file = withExtension(picked);
        const problem = images.rules.check(file, count);
        if (problem) {
          errors.push(problem);
          continue;
        }
        const { key, url } = images.add(file);
        insertImage(editor, { src: url, alt: file.name, inlineKey: key });
        count += 1;
      }
      setImageError(errors.length > 0 ? errors.join(' ') : null);
    };
  }, [editor, images]);

  // O pai limpa o campo (ex.: depois de enviar) passando `value = ''`.
  useEffect(() => {
    if (editor && value === '' && !editor.isEmpty) editor.commands.clearContent();
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    handleRef,
    () => ({
      insertHtml: (html) => {
        editor?.chain().focus().insertContent(html).run();
      },
    }),
    [editor],
  );

  return (
    <Input.Wrapper label={label} id={labelId} required={required} error={error}>
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
            {images && (
              <RichTextEditor.Control
                aria-label="Inserir imagem"
                title="Inserir imagem"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                <ImageIcon />
              </RichTextEditor.Control>
            )}
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content mih={160} />
      </RichTextEditor>
      {images && (
        <input
          ref={fileInput}
          type="file"
          accept={images.rules.accept}
          multiple
          hidden
          aria-label="Arquivo de imagem"
          onChange={(event) => {
            insertImages.current([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = '';
          }}
        />
      )}
      {imageError && (
        <Text size="sm" c="red" mt={4} role="alert">
          {imageError}
        </Text>
      )}
    </Input.Wrapper>
  );
}

function insertImage(editor: Editor, attrs: { src: string; alt: string; inlineKey: string }) {
  editor.chain().focus().insertContent({ type: 'image', attrs }).run();
}

function ImageIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <circle cx={8.5} cy={8.5} r={1.5} />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
