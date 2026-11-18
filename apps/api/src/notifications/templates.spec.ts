import { htmlToText, renderNotification, type NotificationPayload } from './templates.js';

const payload = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  ticketId: 't1',
  ticketNumber: 1001,
  ticketSubject: 'Impressora <script>alert(1)</script>',
  recipientName: 'Maria <script>',
  portalUrl: 'http://portal.test/tickets/t1',
  authorName: 'Ana "agente"',
  bodyHtml: '<p>Troque o <strong>toner</strong> &amp; reinicie.</p>',
  attachments: [],
  resolved: false,
  groupName: 'Suporte TI',
  requesterName: 'Maria',
  companyName: null,
  categoryName: 'Impressoras',
  ...overrides,
});

describe('templates de notificação (T14)', () => {
  it('CT-25 assunto com [#n]; nomes escapados; corpo da mensagem como veio', () => {
    const mail = renderNotification('reply', payload(), true);
    expect(mail.subject).toBe('[#1001] Impressora <script>alert(1)</script>');
    expect(mail.html).toContain('Maria &lt;script&gt;');
    expect(mail.html).toContain('Ana &quot;agente&quot; respondeu');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('<p>Troque o <strong>toner</strong> &amp; reinicie.</p>');
    expect(mail.html).toContain('Responda este e-mail para continuar o atendimento.');
    expect(mail.html).toContain('href="http://portal.test/tickets/t1"');
  });

  it('CT-25 parte texto sem tags, com entidades decodificadas e o link', () => {
    const mail = renderNotification('reply', payload(), true);
    expect(mail.text).toContain('Troque o toner & reinicie.');
    expect(mail.text).not.toContain('<strong>');
    expect(mail.text).not.toContain('<p>');
    expect(mail.text).toContain('Ou acompanhe pelo portal: http://portal.test/tickets/t1');
  });

  it('CT-25 / RN-07 sem link do portal para quem não faz login', () => {
    const mail = renderNotification('ticket_created', payload({ portalUrl: null }), true);
    expect(mail.html).not.toContain('portal');
    expect(mail.text).not.toContain('portal');
    expect(mail.text).toContain('Recebemos o seu chamado #1001');
  });

  it('RN-04 reply com resolved avisa da resolução; resolved sem corpo', () => {
    expect(renderNotification('reply', payload({ resolved: true }), true).text).toContain(
      'Marcamos este chamado como resolvido',
    );
    const resolved = renderNotification('resolved', payload({ bodyHtml: null }), true);
    expect(resolved.text).toContain('foi marcado como resolvido');
    expect(resolved.text).toContain('responda este e-mail e o chamado será reaberto');
  });

  it('RN-19 anexos que não foram no e-mail aparecem por nome', () => {
    const attachments = [
      { filename: 'log.txt', storageKey: 'k', mimeType: 'text/plain', sizeBytes: 1 },
    ];
    expect(renderNotification('reply', payload({ attachments }), false).text).toContain(
      'disponíveis no portal): log.txt.',
    );
    expect(renderNotification('reply', payload({ attachments }), true).text).not.toContain(
      'log.txt',
    );
  });

  describe('assinatura do agente (spec T31)', () => {
    const signatureHtml = '<p><strong>Ana Souza</strong></p><p>TI &amp; Suporte</p>';

    it('CT-16 reply com assinatura: depois do corpo, no HTML e no texto', () => {
      const mail = renderNotification('reply', payload({ signatureHtml }), true);
      expect(mail.html).toContain(
        `reinicie.</p><div style="margin:16px 0 0">${signatureHtml}</div></div>`,
      );
      expect(mail.text).toContain(
        'Troque o toner & reinicie.\n\n-- \nAna Souza\nTI & Suporte\n\nResponda este e-mail',
      );
    });

    it('CT-16 reply com resolved: a assinatura vem antes do aviso de resolução', () => {
      const mail = renderNotification('reply', payload({ signatureHtml, resolved: true }), true);
      for (const part of [mail.html, mail.text]) {
        expect(part.indexOf('Ana Souza')).toBeGreaterThan(part.indexOf('Troque o'));
        expect(part.indexOf('Ana Souza')).toBeLessThan(part.indexOf('Marcamos este chamado'));
      }
    });

    it('CT-16 sem assinatura (ausente ou nula), a saída é a de antes', () => {
      const before = renderNotification('reply', payload(), true);
      expect(renderNotification('reply', payload({ signatureHtml: null }), true)).toEqual(before);
      expect(before.text).not.toContain('-- \n');
      expect(before.html).toContain('reinicie.</p></div>');
    });

    it('CT-16 só o reply usa a assinatura do payload', () => {
      const mail = renderNotification('requester_reply', payload({ signatureHtml }), true);
      expect(mail.html).not.toContain('Ana Souza');
      expect(mail.text).not.toContain('Ana Souza');
    });
  });

  describe('imagem na assinatura (spec T33)', () => {
    const logo = {
      id: 'sig1',
      storageKey: 'attachments/s1',
      filename: 'logo.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    };
    const signed = payload({
      signatureHtml: '<p>Ana Souza</p><img data-signature-image-id="sig1" alt="logo" />',
      signatureImages: [logo],
    });

    it('CT-12 embutida: cid com largura limitada; nada no texto', () => {
      const mail = renderNotification(
        'reply',
        signed,
        true,
        null,
        new Map([['sig1', 'sig-sig1@x.org']]),
      );
      expect(mail.html).toContain(
        '<img src="cid:sig-sig1@x.org" alt="logo" style="max-width:300px;height:auto">',
      );
      expect(mail.html).not.toContain('data-signature-image-id');
      expect(mail.text).toContain('-- \nAna Souza\n');
      expect(mail.text).not.toContain('imagem');
    });

    it('CT-12 não embutida: a imagem some sem aviso e o texto da assinatura fica', () => {
      const mail = renderNotification('reply', signed, true, null, null);
      expect(mail.html).toContain('Ana Souza');
      expect(mail.html).not.toContain('<img');
      expect(mail.text).not.toContain('Imagens grandes demais');
    });

    it('CT-12 assinatura só com imagem não embutida: sem bloco de assinatura', () => {
      const onlyLogo = payload({
        signatureHtml: '<img data-signature-image-id="sig1" />',
        signatureImages: [logo],
      });
      const mail = renderNotification('reply', onlyLogo, true, null, null);
      expect(mail.text).not.toContain('-- \n');
      expect(mail).toEqual(renderNotification('reply', payload(), true));
    });

    it('CT-12 payload anterior à T33 renderiza como antes', () => {
      const old = payload({ signatureHtml: '<p>Ana Souza</p>' });
      expect(renderNotification('reply', old, true, null, null)).toEqual(
        renderNotification('reply', old, true),
      );
    });
  });

  describe('imagens no texto (spec T32)', () => {
    const image = {
      id: 'img-1',
      inline: true,
      filename: 'print.png',
      storageKey: 'attachments/k1',
      mimeType: 'image/png',
      sizeBytes: 10,
    };
    const doc = {
      filename: 'nota.pdf',
      storageKey: 'k2',
      mimeType: 'application/pdf',
      sizeBytes: 5,
    };
    const withImage = payload({
      bodyHtml: '<p>Veja:</p><img data-attachment-id="img-1" alt="tela" />',
      attachments: [image, doc],
    });

    it('CT-18 embutida: cid no HTML e [imagem: nome] no texto', () => {
      const mail = renderNotification(
        'reply',
        withImage,
        true,
        new Map([['img-1', 'img-1@x.org']]),
      );
      expect(mail.html).toContain('<img src="cid:img-1@x.org" alt="tela"');
      expect(mail.html).not.toContain('data-attachment-id');
      expect(mail.text).toContain('Veja:\n[imagem: print.png]');
      expect(mail.html).not.toContain('Imagens grandes demais');
    });

    it('CT-18 não embutida: texto no lugar da imagem e aviso', () => {
      const mail = renderNotification('reply', withImage, true, null);
      expect(mail.html).toContain('[imagem: print.png]');
      expect(mail.html).not.toContain('<img');
      expect(mail.text).toContain('Imagens grandes demais para o e-mail, disponíveis no portal.');
      const external = renderNotification('reply', { ...withImage, portalUrl: null }, true, null);
      expect(external.text).toContain('Imagens grandes demais para o e-mail.');
      expect(external.text).not.toContain('disponíveis no portal');
    });

    it('CT-18 a imagem do texto não entra na lista de anexos não enviados', () => {
      const mail = renderNotification('reply', withImage, false, null);
      expect(mail.text).toContain(
        'Anexos (grandes demais para o e-mail, disponíveis no portal): nota.pdf.',
      );
      expect(mail.text).not.toContain('print.png.');
    });

    it('CT-18 payload anterior à T32 (sem id nem inline) renderiza como antes', () => {
      const old = payload({ attachments: [doc] });
      expect(renderNotification('reply', old, false)).toEqual(
        renderNotification('reply', old, false, null),
      );
      expect(renderNotification('reply', old, false).text).toContain('nota.pdf');
    });
  });

  it('aviso ao grupo traz solicitante, unidade e categoria', () => {
    const mail = renderNotification('ticket_created_group', payload(), true);
    expect(mail.text).toContain('Novo chamado na fila Suporte TI');
    expect(mail.text).toContain(
      'Solicitante: Maria · Unidade: sem unidade · Categoria: Impressoras',
    );
  });

  it('htmlToText trata listas e quebras', () => {
    expect(htmlToText('<ul><li>um</li><li>dois</li></ul><p>a<br>b</p>')).toBe(
      '- um\n- dois\n\na\nb',
    );
  });
});
