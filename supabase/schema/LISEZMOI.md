# Photographie du schéma réel

Ces trois fichiers décrivent la base **telle qu'elle est en production**, et
non telle que les migrations la décrivent : plusieurs objets ont été créés
directement en base, et une migration (002) n'a jamais été appliquée.

Le test `tests/regressions.test.ts` (« schéma réel ») compare le code à cette
photographie : toute table, RPC ou colonne utilisée par le code mais absente
de la base fait échouer les tests — ce qui aurait signalé
`entreprises.description` avant qu'une sauvegarde de fiche échoue.

## Mettre à jour (après chaque migration)

Dans le SQL Editor du tableau de bord, exécuter chaque requête puis
« Download CSV », et remplacer le fichier correspondant.

```sql
-- columns.csv
select table_name, column_name, data_type, is_nullable
  from information_schema.columns where table_schema = 'public'
 order by table_name, ordinal_position;

-- functions.csv
select n.nspname as schema, p.proname as nom, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'app') order by 1, 2;

-- rules.csv
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;
```

Une migration qui AJOUTE une colonne utilisée par le code doit être appliquée,
puis la photographie mise à jour, AVANT de livrer le code qui l'utilise.
