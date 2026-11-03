import { useState } from 'react';
import type { Category, Company, Intent } from '../../core/types';
import { Button, Field, MultiToggle } from '../components';
import { CITY_NAMES } from '../../core/catalog';
import { INTENT_LABEL } from '../../core/status';
import { normalizePhone } from '../../core/phone';

export function CompanyForm({ initial, categories, onSubmit, onCancel, submitting, submitLabel = 'Enregistrer' }: {
  initial: Company;
  categories: Category[];
  onSubmit: (c: Company) => void;
  onCancel: () => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const [c, setC] = useState<Company>(initial);
  const [touched, setTouched] = useState(false);
  const [productsText, setProductsText] = useState(initial.products.join(', '));
  const set = <K extends keyof Company>(k: K, v: Company[K]) => setC((x) => ({ ...x, [k]: v }));
  const errors = {
    name: c.name.trim().length < 2 ? 'Nom obligatoire' : undefined,
    whatsapp: !normalizePhone(c.whatsappNumber).ok ? 'Numéro invalide (ex. 06 61 23 45 67)' : undefined,
    intents: c.acceptedIntents.length === 0 ? 'Au moins un type' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <form
      className="col"
      style={{ gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (hasErrors) return;
        onSubmit({ ...c, products: productsText.split(',').map((p) => p.trim()).filter(Boolean) });
      }}
    >
      <div className="grid-2">
        <Field label="Nom de l’entreprise" error={touched ? errors.name : undefined}>
          <input className={`input ${touched && errors.name ? 'invalid' : ''}`} value={c.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Ville">
          <select className="select" value={c.city} onChange={(e) => set('city', e.target.value)}>
            {CITY_NAMES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Secteur">
          <select className="select" value={c.sector} onChange={(e) => set('sector', e.target.value)}>
            {categories.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Activité">
          <input className="input" value={c.activity} onChange={(e) => set('activity', e.target.value)} placeholder="ex. Vente et pose de climatiseurs" />
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Produits et services" hint="Séparés par des virgules — utilisés par le moteur de matching">
            <input className="input" value={productsText} onChange={(e) => setProductsText(e.target.value)} />
          </Field>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Description">
            <textarea className="textarea" value={c.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <Field label="Téléphone">
          <input className="input" value={c.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={c.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Adresse">
          <input className="input" value={c.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Site web">
          <input className="input" value={c.website} onChange={(e) => set('website', e.target.value)} />
        </Field>
        <Field label="WhatsApp de réception des demandes" hint="Numéro choisi par l’entreprise (envoi simulé)" error={touched ? errors.whatsapp : undefined}>
          <input className={`input ${touched && errors.whatsapp ? 'invalid' : ''}`} value={c.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} placeholder="+212 6 …" />
        </Field>
        <Field label="Note clients (0–5)">
          <input className="input" type="number" min={0} max={5} step={0.1} value={c.rating} onChange={(e) => set('rating', Math.min(5, Math.max(0, Number(e.target.value))))} />
        </Field>
      </div>

      <Field label="Villes couvertes (en plus de la ville du siège)">
        <MultiToggle options={CITY_NAMES.filter((x) => x !== c.city).map((x) => ({ value: x, label: x }))} value={c.coveredCities} onChange={(v) => set('coveredCities', v)} />
      </Field>
      <Field label="Catégories de demandes acceptées">
        <MultiToggle options={categories.map((x) => ({ value: x.id, label: x.label }))} value={c.acceptedCategories} onChange={(v) => set('acceptedCategories', v)} />
      </Field>
      <Field label="Types de demandes acceptés" error={touched ? errors.intents : undefined}>
        <MultiToggle options={(Object.keys(INTENT_LABEL) as Intent[]).map((k) => ({ value: k, label: INTENT_LABEL[k].label }))} value={c.acceptedIntents} onChange={(v) => set('acceptedIntents', v)} />
      </Field>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Annuler</Button>
        <Button variant="primary" type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
