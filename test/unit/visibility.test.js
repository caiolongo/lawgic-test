import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isFieldVisible, resolveVisibleFields, buildForm } from '../../src/domain/visibility.js';
import { README_EXPECTED } from '../fixtures/readme-expected.js';

const realFields = JSON.parse(readFileSync(new URL('../../data/fields.json', import.meta.url), 'utf8'));

describe('isFieldVisible', () => {
  const field = (attached) => ({ key: 'CAMPO', type: 'text', ...(attached && { attached }) });

  it('campo sem attached é sempre visível', () => {
    assert.equal(isFieldVisible(field(), {}), true);
  });

  it('attached vazio é visível', () => {
    assert.equal(isFieldVisible(field([]), {}), true);
  });

  it('visível quando a condição vale e oculto quando não vale', () => {
    const conditional = field([{ key: 'A', values: ['X'] }]);
    assert.equal(isFieldVisible(conditional, { A: 'X' }), true);
    assert.equal(isFieldVisible(conditional, { A: 'Y' }), false);
  });

  it('a condição vale quando o valor é qualquer um de values (OU)', () => {
    const conditional = field([{ key: 'A', values: ['X', 'Y'] }]);
    assert.equal(isFieldVisible(conditional, { A: 'X' }), true);
    assert.equal(isFieldVisible(conditional, { A: 'Y' }), true);
    assert.equal(isFieldVisible(conditional, { A: 'Z' }), false);
  });

  it('exige todas as condições (E), com a regra real de duas condições de data/', () => {
    const real = realFields.find((f) => f.attached?.length > 1);
    const satisfied = Object.fromEntries(real.attached.map((c) => [c.key, c.values[0]]));
    assert.equal(isFieldVisible(real, satisfied), true);

    for (const condition of real.attached) {
      assert.equal(isFieldVisible(real, { ...satisfied, [condition.key]: null }), false, condition.key);
    }
  });

  it('valor null não satisfaz a condição', () => {
    assert.equal(isFieldVisible(field([{ key: 'A', values: ['X'] }]), { A: null }), false);
  });

  it('condição com key inexistente deixa o campo oculto', () => {
    assert.equal(isFieldVisible(field([{ key: 'NAO_EXISTE', values: ['X'] }]), { A: 'X' }), false);
    assert.equal(isFieldVisible(field([{ key: 'constructor', values: ['X'] }]), {}), false);
  });

  it('compara com o value limpo, não com o label', () => {
    assert.equal(isFieldVisible(field([{ key: 'A', values: ['S'] }]), { A: 'Sim' }), false);
  });
});

describe('resolveVisibleFields', () => {
  const field = (key, attached) => ({ key, type: 'text', ...(attached && { attached }) });
  const keysOf = (fields) => fields.map((f) => f.key);

  it('mantém todos os campos sem attached', () => {
    const fields = [field('A'), field('B')];
    assert.deepEqual(keysOf(resolveVisibleFields(fields, {})), ['A', 'B']);
  });

  it('esconde o campo cuja condição não vale', () => {
    const fields = [field('A'), field('B', [{ key: 'A', values: ['X'] }])];
    assert.deepEqual(keysOf(resolveVisibleFields(fields, { A: 'Y', B: 'valor' })), ['A']);
  });

  const parent = field('A');
  const child = field('B', [{ key: 'A', values: ['X'] }]);
  const grandchild = field('C', [{ key: 'B', values: ['Z'] }]);
  const values = { A: 'Y', B: 'Z', C: 'valor' };

  it('em cascata: campo que depende de um campo oculto também fica oculto (D-06)', () => {
    assert.deepEqual(keysOf(resolveVisibleFields([parent, child, grandchild], values)), ['A']);
  });

  it('não depende da ordem dos campos', () => {
    assert.deepEqual(keysOf(resolveVisibleFields([grandchild, child, parent], values)), ['A']);
  });

  it('termina com dependência circular e mantém os dois visíveis quando as condições valem', () => {
    const fields = [field('A', [{ key: 'B', values: ['1'] }]), field('B', [{ key: 'A', values: ['1'] }])];
    assert.deepEqual(keysOf(resolveVisibleFields(fields, { A: '1', B: '1' })), ['A', 'B']);
    assert.deepEqual(keysOf(resolveVisibleFields(fields, { A: '1', B: '2' })), []);
  });

  it('devolve os campos na ordem recebida', () => {
    const fields = [field('C'), field('A'), field('B')];
    assert.deepEqual(keysOf(resolveVisibleFields(fields, {})), ['C', 'A', 'B']);
  });

  it('nos dados de data/, cascata e não cascata dão o mesmo resultado para toda combinação de selects', () => {
    for (const companyKey of new Set(realFields.map((f) => f.companyKey))) {
      const fields = realFields.filter((f) => f.companyKey === companyKey);
      const selects = fields.filter((f) => f.type === 'select');
      let combinations = [{}];
      for (const select of selects) {
        const choices = [null, ...select.options.map((o) => o.value)];
        combinations = combinations.flatMap((combo) => choices.map((choice) => ({ ...combo, [select.key]: choice })));
      }

      for (const combo of combinations) {
        const withoutCascade = fields.filter((f) => isFieldVisible(f, combo));
        assert.deepEqual(keysOf(resolveVisibleFields(fields, combo)), keysOf(withoutCascade), `${companyKey} ${JSON.stringify(combo)}`);
      }
    }
  });
});

describe('buildForm', () => {
  const fieldsOf = (companyKey) => realFields.filter((f) => f.companyKey === companyKey);

  for (const [doc, { companyKey, formData, missingRequired }] of Object.entries(README_EXPECTED)) {
    it(`${companyKey} + ${doc}: formData idêntico ao esperado do README, sem os campos ocultos`, () => {
      const fields = fieldsOf(companyKey);
      const hiddenValues = Object.fromEntries(fields.filter((f) => !(f.key in formData)).map((f) => [f.key, 'valor da IA']));

      const form = buildForm(fields, { ...formData, ...hiddenValues });

      assert.deepEqual(form, { formData, missingRequired });
      assert.deepEqual(Object.keys(form.formData), Object.keys(formData));
    });
  }

  it('campo required condicional só é obrigatório quando visível (B6)', () => {
    const fields = fieldsOf('acme-edu');
    const conditionalRequired = fields.find((f) => f.required && f.attached);
    const [condition] = conditionalRequired.attached;
    const otherValue = fields.find((f) => f.key === condition.key).options.find((o) => !condition.values.includes(o.value)).value;

    const shown = buildForm(fields, { [condition.key]: condition.values[0] });
    assert.ok(conditionalRequired.key in shown.formData);
    assert.ok(shown.missingRequired.includes(conditionalRequired.key));

    const hidden = buildForm(fields, { [condition.key]: otherValue });
    assert.equal(conditionalRequired.key in hidden.formData, false);
    assert.equal(hidden.missingRequired.includes(conditionalRequired.key), false);
  });

  const field = (key, order, extra = {}) => ({ key, order, label: key, type: 'text', ...extra });

  it('lista os required visíveis e vazios, na ordem, e ignora required ausente', () => {
    const fields = [
      field('C', 3, { required: true }),
      field('A', 1, { required: true }),
      field('B', 2),
      field('D', 4, { required: false }),
      field('E', 5, { required: true }),
    ];

    const form = buildForm(fields, { E: 'preenchido' });

    assert.deepEqual(form.missingRequired, ['A', 'C']);
    assert.deepEqual(form.formData, { A: null, B: null, C: null, D: null, E: 'preenchido' });
  });

  it('ordena por order e desempata por key, mesmo com os campos embaralhados', () => {
    const fields = [field('Z', 2), field('B', 1), field('A', 2)];
    assert.deepEqual(Object.keys(buildForm(fields, {}).formData), ['B', 'A', 'Z']);
  });

  it('nunca inclui campo oculto, mesmo que a IA tenha devolvido valor', () => {
    const fields = [field('A', 1), field('B', 2, { required: true, attached: [{ key: 'A', values: ['X'] }] })];
    assert.deepEqual(buildForm(fields, { A: 'Y', B: 'valor' }), { formData: { A: 'Y' }, missingRequired: [] });
  });
});
