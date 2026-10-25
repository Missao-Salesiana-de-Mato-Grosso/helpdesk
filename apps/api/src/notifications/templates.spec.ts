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
