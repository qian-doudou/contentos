import { z } from 'zod';

export type JsonSchemaDefinition = {
  type:
    | 'object'
    | 'array'
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'null';
  title?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaDefinition>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaDefinition;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export const jsonSchemaDefinitionSchema: z.ZodType<JsonSchemaDefinition> =
  z.lazy(() =>
    z
      .object({
        type: z.enum([
          'object',
          'array',
          'string',
          'number',
          'integer',
          'boolean',
          'null',
        ]),
        title: z.string().max(160).optional(),
        description: z.string().max(1000).optional(),
        enum: z.array(z.unknown()).min(1).optional(),
        properties: z
          .record(z.string().min(1), jsonSchemaDefinitionSchema)
          .optional(),
        required: z.array(z.string().min(1)).optional(),
        additionalProperties: z.boolean().optional(),
        items: jsonSchemaDefinitionSchema.optional(),
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().nonnegative().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        minItems: z.number().int().nonnegative().optional(),
        maxItems: z.number().int().nonnegative().optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.type === 'object' && !value.properties)
          context.addIssue({
            code: 'custom',
            path: ['properties'],
            message: 'object Schema 必须声明 properties',
          });
        if (value.type === 'array' && !value.items)
          context.addIssue({
            code: 'custom',
            path: ['items'],
            message: 'array Schema 必须声明 items',
          });
        if (value.required?.some((key) => !value.properties?.[key]))
          context.addIssue({
            code: 'custom',
            path: ['required'],
            message: 'required 字段必须存在于 properties',
          });
      }),
  );

export function zodFromJsonSchema(definition: unknown): z.ZodType {
  const schema = jsonSchemaDefinitionSchema.parse(definition);
  let result: z.ZodType;
  switch (schema.type) {
    case 'object': {
      const required = new Set(schema.required ?? []);
      const shape = Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => {
          const value = zodFromJsonSchema(child);
          return [key, required.has(key) ? value : value.optional()];
        }),
      );
      result =
        schema.additionalProperties === true
          ? z.object(shape).loose()
          : z.object(shape).strict();
      break;
    }
    case 'array': {
      let value = z.array(zodFromJsonSchema(schema.items));
      if (schema.minItems !== undefined) value = value.min(schema.minItems);
      if (schema.maxItems !== undefined) value = value.max(schema.maxItems);
      result = value;
      break;
    }
    case 'string': {
      let value = z.string();
      if (schema.minLength !== undefined) value = value.min(schema.minLength);
      if (schema.maxLength !== undefined) value = value.max(schema.maxLength);
      result = value;
      break;
    }
    case 'integer': {
      let value = z.number().int();
      if (schema.minimum !== undefined) value = value.min(schema.minimum);
      if (schema.maximum !== undefined) value = value.max(schema.maximum);
      result = value;
      break;
    }
    case 'number': {
      let value = z.number();
      if (schema.minimum !== undefined) value = value.min(schema.minimum);
      if (schema.maximum !== undefined) value = value.max(schema.maximum);
      result = value;
      break;
    }
    case 'boolean':
      result = z.boolean();
      break;
    case 'null':
      result = z.null();
      break;
  }
  if (schema.enum)
    result = result.refine(
      (value) => schema.enum?.some((item) => Object.is(item, value)),
      '值不在 Schema enum 中',
    );
  return result;
}

export function deterministicMockFromSchema(
  definition: unknown,
  label = 'ContentOS Mock',
): unknown {
  const schema = jsonSchemaDefinitionSchema.parse(definition);
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [
          key,
          deterministicMockFromSchema(child, label),
        ]),
      );
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () =>
        deterministicMockFromSchema(schema.items, label),
      );
    case 'string':
      return label
        .slice(0, schema.maxLength ?? label.length)
        .padEnd(schema.minLength ?? 0, '示');
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
  }
}
