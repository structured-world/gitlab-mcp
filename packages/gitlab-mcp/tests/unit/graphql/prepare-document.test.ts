/**
 * prepareDocument adapts a query to the connected instance's schema so one
 * document serves every supported GitLab version: unknown fragment types and
 * missing @optional fields are dropped, essential fields are kept so GitLab can
 * report them, and the client-only @optional directive never reaches GitLab.
 */

import { gql } from 'graphql-tag';
import { print } from 'graphql';
import { prepareDocument } from '../../../src/graphql/prepare-document';
import type { IndexedField, SchemaFieldIndex } from '../../../src/services/SchemaIntrospector';

const field = (type: string, args: string[] = []): IndexedField => ({ type, args: new Set(args) });

// An "old" schema: Tag has no mediaType, the Color widget type does not exist.
const oldSchema: SchemaFieldIndex = new Map([
  ['Query', new Map([['repo', field('Repo', ['id'])]])],
  [
    'Repo',
    new Map([
      ['name', field('String')],
      ['tags', field('Tag')],
      ['widgets', field('Widget')],
    ]),
  ],
  ['Tag', new Map([['name', field('String')]])],
  ['Widget', new Map([['type', field('String')]])],
  ['WidgetLabels', new Map([['labels', field('String')]])],
]);

const QUERY = gql`
  query Q($id: ID!, $since: String) {
    repo(id: $id) {
      name
      tags {
        name
        mediaType @optional
        publishedAt(since: $since) @optional
      }
      widgets {
        type
        ... on WidgetLabels {
          labels
        }
        ... on WidgetColor {
          color
        }
      }
    }
  }
`;

describe('prepareDocument', () => {
  it('drops missing @optional fields and fragments on unknown types', () => {
    const printed = print(prepareDocument(QUERY, oldSchema).document);

    expect(printed).not.toContain('mediaType');
    expect(printed).not.toContain('publishedAt');
    expect(printed).not.toContain('WidgetColor');
    // Known selections survive untouched.
    expect(printed).toContain('... on WidgetLabels');
    expect(printed).toContain('name');
  });

  it('removes variable definitions only the dropped selections used', () => {
    // GitLab rejects a declared-but-unused variable.
    const prepared = prepareDocument(QUERY, oldSchema);
    expect(print(prepared.document)).not.toContain('$since');
    expect([...prepared.variableNames]).toEqual(['id']);
  });

  it('keeps an essential missing field so GitLab reports it', () => {
    // Silently dropping it would turn an unsupported query into an empty answer.
    const doc = gql`
      query {
        repo(id: 1) {
          missingEssential
        }
      }
    `;
    expect(print(prepareDocument(doc, oldSchema).document)).toContain('missingEssential');
  });

  it('keeps present @optional fields and strips the directive', () => {
    const newSchema: SchemaFieldIndex = new Map([
      ...oldSchema,
      ['Tag', new Map([...oldSchema.get('Tag')!, ['mediaType', field('String')]])],
    ]);
    const printed = print(prepareDocument(QUERY, newSchema).document);

    expect(printed).toContain('mediaType');
    expect(printed).not.toContain('@optional');
  });

  it('only strips the directive when the schema is unknown', () => {
    const prepared = prepareDocument(QUERY, undefined);
    const printed = print(prepared.document);

    expect(printed).toContain('mediaType');
    expect(printed).toContain('WidgetColor');
    expect(printed).not.toContain('@optional');
    expect(new Set(prepared.variableNames)).toEqual(new Set(['id', 'since']));
  });

  it('keeps a field whose optional children are all missing as a valid selection', () => {
    // Keeping the original selection would send the client-only @optional
    // directive and the missing fields, so GitLab would reject the whole query.
    const doc = gql`
      query {
        repo(id: 1) {
          tags {
            mediaType @optional
          }
        }
        gone @optional
      }
    `;
    const printed = print(prepareDocument(doc, oldSchema).document);

    expect(printed).not.toContain('@optional');
    expect(printed).not.toContain('mediaType');
    expect(printed).not.toContain('gone');
    expect(printed).toMatch(/tags\s*\{\s*__typename\s*\}/);
  });

  it('answers with __typename when every root selection is dropped', () => {
    const doc = gql`
      query {
        gone @optional
      }
    `;
    const printed = print(prepareDocument(doc, oldSchema).document);

    expect(printed).not.toContain('@optional');
    expect(printed).toMatch(/\{\s*__typename\s*\}/);
  });

  it('drops an optional field whose children are all missing', () => {
    const doc = gql`
      query {
        repo(id: 1) {
          name
          tags @optional {
            mediaType @optional
          }
        }
      }
    `;
    expect(print(prepareDocument(doc, oldSchema).document)).not.toContain('tags');
  });

  it('prunes inside typeless and named fragments, and drops emptied ones', () => {
    const doc = gql`
      query {
        repo(id: 1) {
          ... {
            name
            mediaType @optional
          }
          ... on Repo {
            mediaType @optional
          }
          ...RepoTags
        }
      }
      fragment RepoTags on Repo {
        tags {
          name
        }
      }
    `;
    const printed = print(prepareDocument(doc, oldSchema).document);

    expect(printed).not.toContain('mediaType');
    expect(printed).not.toContain('... on Repo');
    // The typeless fragment inherits the enclosing type and keeps its known field.
    expect(printed).toMatch(/\.\.\.\s*\{\s*name\s*\}/);
    // Named fragments and their spreads pass through untouched.
    expect(printed).toContain('...RepoTags');
    expect(printed).toContain('fragment RepoTags on Repo');
  });

  it('returns the same prepared document for the same schema', () => {
    expect(prepareDocument(QUERY, oldSchema)).toBe(prepareDocument(QUERY, oldSchema));
  });
});
