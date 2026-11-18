import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createInlineImageStore } from '../features/attachments/inline-images.ts';
import { theme } from '../theme.ts';
import { HtmlEditor, type HtmlEditorHandle, type HtmlEditorProps } from './HtmlEditor.tsx';

describe('HtmlEditor', () => {
  it('renderiza a barra em pt-BR e a área de texto rotulada', async () => {
    render(
      <MantineProvider theme={theme} env="test">
        <HtmlEditor label="Descrição" value="<p>oi</p>" onChange={vi.fn()} error="Erro" />
      </MantineProvider>,
    );
    expect(await screen.findByRole('textbox', { name: /Descrição/ })).toHaveTextContent('oi');
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inserir link' })).toBeInTheDocument();
    expect(screen.getByText('Erro')).toBeInTheDocument();
  });

  it('insertHtml (T26) acrescenta o HTML sem apagar o texto e avisa o pai', async () => {
    const onChange = vi.fn();
    const handle = createRef<HtmlEditorHandle>();
    render(
      <MantineProvider theme={theme} env="test">
        <HtmlEditor
          label="Resposta"
          value="<p>Bom dia.</p>"
          onChange={onChange}
          handleRef={handle}
        />
      </MantineProvider>,
    );
    await screen.findByRole('textbox', { name: /Resposta/ });
    await waitFor(() => expect(handle.current).not.toBeNull());
    act(() => handle.current!.insertHtml('<p>Olá, <strong>Maria</strong>!</p>'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = String(onChange.mock.lastCall?.[0]);
    expect(html).toContain('Bom dia.');
    expect(html).toContain('<strong>Maria</strong>');
  });
});

function renderEditor(props: Partial<HtmlEditorProps> = {}) {
  const onChange = vi.fn();
  render(
    <MantineProvider theme={theme} env="test">
      <HtmlEditor label="Resposta" value="" onChange={onChange} {...props} />
    </MantineProvider>,
  );
  return onChange;
}

const png = (name = 'print.png', size = 3) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

describe('HtmlEditor — imagens no texto (spec T32)', () => {
  it('CT-23 sem store de imagens não há botão nem campo de imagem', async () => {
    renderEditor();
    await screen.findByRole('textbox', { name: /Resposta/ });
    expect(screen.queryByRole('button', { name: 'Inserir imagem' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo de imagem')).not.toBeInTheDocument();
  });

  it('CT-21 inserir imagem: prévia blob, chave no HTML e arquivo na store', async () => {
    const createObjectURL = vi.fn(() => 'blob:previa');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const images = createInlineImageStore();
    const onChange = renderEditor({ images });
    expect(await screen.findByRole('button', { name: 'Inserir imagem' })).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText('Arquivo de imagem'), png());
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = String(onChange.mock.lastCall?.[0]);
    expect(html).toContain('src="blob:previa"');
    const upload = images.collect(html);
    expect(upload.inline.map((file) => file.name)).toEqual(['print.png']);
    expect(html).toContain(`data-inline-key="${upload.inlineImages[0]}"`);
    vi.unstubAllGlobals();
  });

  it('CT-22 recusa tipo não aceito e imagem acima de 5 MB, com mensagem', async () => {
    const images = createInlineImageStore();
    const onChange = renderEditor({ images });
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText('Arquivo de imagem');

    await user.upload(input, new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'doc.pdf: só imagens PNG, JPG, GIF ou WebP no texto.',
    );
    await user.upload(input, png('grande.png', 5 * 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent('grande.png: imagem acima de 5 MB.');
    // O foco pode disparar um update vazio; imagem nenhuma entra no texto.
    expect(onChange.mock.calls.flat().join('')).not.toContain('<img');
  });
});
