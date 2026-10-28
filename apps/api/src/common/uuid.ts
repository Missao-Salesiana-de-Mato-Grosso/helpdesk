const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids de rota que não são UUID respondem 404 (o Prisma rejeitaria com erro interno). */
export const isUuid = (value: string): boolean => UUID.test(value);
