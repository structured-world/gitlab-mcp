import path from 'node:path';
import ts from 'typescript';

// Inspect real syntax and symbol initializers, including paths assembled in local helpers.
// New tool arguments must be encoded before becoming authenticated REST path segments.
it('encodes every dynamic REST path argument', () => {
  const root = path.resolve(__dirname, '../../../src');
  const files = ts.sys.readDirectory(root, ['.ts'], undefined, ['**/*.ts']);
  const configPath = path.join(root, '../tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const failures: string[] = [];
  const safeCalls = new Set([
    'normalizeProjectId',
    'encodeApiSegment',
    'encodeURIComponent',
    'paths.project',
    'paths.group',
    'paths.namespace',
  ]);

  const safe = (node: ts.Expression, seen = new Set<ts.Node>()): boolean => {
    if (seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
    if (ts.isParenthesizedExpression(node)) return safe(node.expression, next);
    if (ts.isConditionalExpression(node))
      return safe(node.whenTrue, next) && safe(node.whenFalse, next);
    if (ts.isTemplateExpression(node)) return templateSafe(node, next);
    const type = checker.getTypeAtLocation(node);
    if (type.flags & ts.TypeFlags.NumberLike) return true;
    const types = type.isUnion() ? type.types : [type];
    if (types.every((t) => t.isStringLiteral() && /^[a-zA-Z0-9_-]+$/.test(t.value))) return true;
    if (ts.isCallExpression(node)) {
      if (safeCalls.has(node.expression.getText())) return true;
      let declaration: ts.Node | undefined;
      if (ts.isArrowFunction(node.expression)) declaration = node.expression;
      else declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration;
      if (
        declaration &&
        (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration))
      )
        declaration = declaration.initializer;
      if (
        declaration &&
        (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration))
      ) {
        const body = declaration.body;
        if (body && !ts.isBlock(body)) return safe(body, next);
        if (body) {
          const returns: ts.Expression[] = [];
          const find = (child: ts.Node): void => {
            if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
            else ts.forEachChild(child, find);
          };
          find(body);
          return returns.length > 0 && returns.every((value) => safe(value, next));
        }
      }
    }
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isBindingElement(declaration)) {
        const binding = declaration.parent.parent;
        if (
          ts.isVariableDeclaration(binding) &&
          binding.initializer &&
          ts.isAwaitExpression(binding.initializer)
        ) {
          const call = binding.initializer.expression;
          if (ts.isCallExpression(call) && call.expression.getText() === 'resolveNamespaceForAPI')
            return true;
        }
      }
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
        return safe(declaration.initializer, next);
    }
    return false;
  };

  const templateSafe = (node: ts.TemplateExpression, seen: Set<ts.Node>): boolean => {
    let literal = node.head.text;
    let inApiPath = !node.getText().includes('/api/v4/');
    for (const span of node.templateSpans) {
      if (literal.includes('/api/v4/')) inApiPath = true;
      if (inApiPath && literal.includes('?')) return true;
      if (inApiPath && !safe(span.expression, seen)) return false;
      literal = span.literal.text;
    }
    return true;
  };

  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const visit = (node: ts.Node): void => {
      // Delegated paths are inspected where their URL/path template is constructed.
      // The REST client's own assembly is covered by assertSafeApiPath runtime tests.
      const restTemplate =
        ts.isTemplateExpression(node) &&
        file !== path.join(root, 'utils/gitlab-api.ts') &&
        /\/api\/v4\/|(?:^`|\/)projects\/|(?:^`|\/)groups\/|(?:^`|\/)snippets\//.test(
          node.getText(),
        );
      const restCall =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText() === 'gitlab' &&
        ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text);
      const callArg = restCall ? node.arguments[0] : undefined;
      const argument = restTemplate
        ? node
        : callArg && ts.isTemplateExpression(callArg)
          ? callArg
          : undefined;
      if (argument && !safe(argument)) {
        const line = source.getLineAndCharacterOfPosition(argument.getStart()).line + 1;
        failures.push(`${path.relative(root, file)}:${line}: ${argument.getText().slice(0, 200)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(failures).toEqual([]);
}, 30000);
