-- =============================================
-- FILAO: Migration 025 — Advanced Skills & Activity Taxonomy
-- =============================================

-- 1. Reference Tables
CREATE TABLE IF NOT EXISTS ref_domains (
    id TEXT PRIMARY KEY, -- DOM-01, etc.
    label TEXT NOT NULL,
    natures TEXT[] NOT NULL, -- ['travaux', 'services', 'fournitures']
    display_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_specialties (
    id TEXT PRIMARY KEY, -- SPE-0101, etc.
    domain_id TEXT REFERENCES ref_domains(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    display_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_expertise_tags (
    id TEXT PRIMARY KEY, -- TAG-ENV-01, etc.
    thematic TEXT NOT NULL, -- 'environnement', 'contexte', 'methodologie', 'certification'
    label TEXT NOT NULL,
    display_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_geo_zones (
    id TEXT PRIMARY KEY, -- GEO-01, etc.
    label TEXT NOT NULL,
    zone_type TEXT NOT NULL, -- 'metropole', 'domtom'
    display_order INT DEFAULT 0
);

-- 2. Company Activity & Skills Tables (Junctions)
CREATE TABLE IF NOT EXISTS company_natures (
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
    nature TEXT NOT NULL, -- travaux, services, fournitures
    PRIMARY KEY (entreprise_id, nature)
);

CREATE TABLE IF NOT EXISTS company_domains (
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
    domain_id TEXT REFERENCES ref_domains(id) ON DELETE CASCADE,
    PRIMARY KEY (entreprise_id, domain_id)
);

CREATE TABLE IF NOT EXISTS company_specialties (
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
    specialty_id TEXT REFERENCES ref_specialties(id) ON DELETE CASCADE,
    custom_label TEXT, -- For "Autre" fields
    PRIMARY KEY (entreprise_id, specialty_id)
);

CREATE TABLE IF NOT EXISTS company_expertise_tags (
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES ref_expertise_tags(id) ON DELETE CASCADE,
    custom_label TEXT, -- For "Autre" fields
    PRIMARY KEY (entreprise_id, tag_id)
);

CREATE TABLE IF NOT EXISTS company_geo_zones (
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE,
    geo_zone_id TEXT REFERENCES ref_geo_zones(id) ON DELETE CASCADE,
    PRIMARY KEY (entreprise_id, geo_zone_id)
);

-- 3. Tender Skills Table
CREATE TABLE IF NOT EXISTS reponses_ao_specialties (
    reponse_ao_id UUID REFERENCES reponses_ao(id) ON DELETE CASCADE,
    specialty_id TEXT REFERENCES ref_specialties(id) ON DELETE CASCADE,
    PRIMARY KEY (reponse_ao_id, specialty_id)
);

-- 4. Enable RLS
ALTER TABLE ref_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_expertise_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_geo_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_natures ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_expertise_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_geo_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE reponses_ao_specialties ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies

-- Public read for reference tables
CREATE POLICY "Public read for ref_domains" ON ref_domains FOR SELECT USING (true);
CREATE POLICY "Public read for ref_specialties" ON ref_specialties FOR SELECT USING (true);
CREATE POLICY "Public read for ref_expertise_tags" ON ref_expertise_tags FOR SELECT USING (true);
CREATE POLICY "Public read for ref_geo_zones" ON ref_geo_zones FOR SELECT USING (true);

-- Company-specific access
CREATE POLICY "Manage own company natures" ON company_natures
    FOR ALL USING (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

CREATE POLICY "Manage own company domains" ON company_domains
    FOR ALL USING (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

CREATE POLICY "Manage own company specialties" ON company_specialties
    FOR ALL USING (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

CREATE POLICY "Manage own company expertise tags" ON company_expertise_tags
    FOR ALL USING (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

CREATE POLICY "Manage own company geo zones" ON company_geo_zones
    FOR ALL USING (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

-- Tender-specific access
CREATE POLICY "Manage reponses_ao skills" ON reponses_ao_specialties
    FOR ALL USING (reponse_ao_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()));

-- 6. Seed Data: Domains
INSERT INTO ref_domains (id, label, natures, display_order) VALUES
('DOM-01', 'Gros œuvre / Structure', ARRAY['travaux'], 1),
('DOM-02', 'Second œuvre / Finitions', ARRAY['travaux'], 2),
('DOM-03', 'Génie climatique / Fluides', ARRAY['travaux'], 3),
('DOM-04', 'Électricité / Courants', ARRAY['travaux'], 4),
('DOM-05', 'VRD / Terrassement / Génie civil extérieur', ARRAY['travaux'], 5),
('DOM-06', 'Démolition / Dépollution / Désamiantage', ARRAY['travaux'], 6),
('DOM-07', 'Espaces verts / Paysage', ARRAY['travaux'], 7),
('DOM-08', 'Architecture / Maîtrise d''œuvre', ARRAY['services'], 8),
('DOM-09', 'Ingénierie / Bureaux d''études techniques', ARRAY['services'], 9),
('DOM-10', 'Informatique / Numérique', ARRAY['services'], 10),
('DOM-11', 'Conseil / AMO / Services intellectuels', ARRAY['services'], 11),
('DOM-12', 'Communication / Événementiel / Création', ARRAY['services'], 12),
('DOM-13', 'Formation / Enseignement', ARRAY['services'], 13),
('DOM-14', 'Propreté / Hygiène / Maintenance', ARRAY['services'], 14),
('DOM-15', 'Sécurité / Sûreté', ARRAY['services'], 15),
('DOM-16', 'Transport / Logistique', ARRAY['services'], 16),
('DOM-17', 'Fournitures / Équipements', ARRAY['fournitures'], 17),
('DOM-18', 'Restauration / Alimentation', ARRAY['services', 'fournitures'], 18),
('DOM-19', 'Environnement / Énergie / Eau', ARRAY['services'], 19),
('DOM-20', 'Santé / Social / Médico-social', ARRAY['services'], 20)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, natures = EXCLUDED.natures, display_order = EXCLUDED.display_order;

-- 7. Seed Data: Specialties
INSERT INTO ref_specialties (id, domain_id, label, display_order) VALUES
-- DOM-01
('SPE-0101', 'DOM-01', 'Maçonnerie générale', 1),
('SPE-0102', 'DOM-01', 'Béton armé / Précontraint', 2),
('SPE-0103', 'DOM-01', 'Charpente bois', 3),
('SPE-0104', 'DOM-01', 'Charpente métallique', 4),
('SPE-0105', 'DOM-01', 'Ossature bois', 5),
('SPE-0106', 'DOM-01', 'Construction modulaire / Préfabriquée', 6),
('SPE-0107', 'DOM-01', 'Fondations spéciales', 7),
('SPE-0108', 'DOM-01', 'Génie civil', 8),
('SPE-0199', 'DOM-01', 'Autre (champ texte libre)', 99),
-- DOM-02
('SPE-0201', 'DOM-02', 'Plâtrerie / Cloisons sèches', 1),
('SPE-0202', 'DOM-02', 'Isolation thermique / Acoustique', 2),
('SPE-0203', 'DOM-02', 'Menuiseries intérieures', 3),
('SPE-0204', 'DOM-02', 'Menuiseries extérieures (alu, PVC, bois)', 4),
('SPE-0205', 'DOM-02', 'Peinture / Ravalement', 5),
('SPE-0206', 'DOM-02', 'Revêtements de sols (carrelage, parquet, résine, souple)', 6),
('SPE-0207', 'DOM-02', 'Revêtements muraux', 7),
('SPE-0208', 'DOM-02', 'Faux plafonds', 8),
('SPE-0209', 'DOM-02', 'Serrurerie / Métallerie', 9),
('SPE-0210', 'DOM-02', 'Vitrerie / Miroiterie', 10),
('SPE-0211', 'DOM-02', 'Agencement / Ébénisterie', 11),
('SPE-0212', 'DOM-02', 'Stores / Fermetures', 12),
('SPE-0299', 'DOM-02', 'Autre (champ texte libre)', 99),
-- DOM-03
('SPE-0301', 'DOM-03', 'CVC (chauffage, ventilation, climatisation)', 1),
('SPE-0302', 'DOM-03', 'Plomberie / Sanitaire', 2),
('SPE-0303', 'DOM-03', 'Traitement d''air', 3),
('SPE-0304', 'DOM-03', 'Désenfumage', 4),
('SPE-0305', 'DOM-03', 'Fluides médicaux', 5),
('SPE-0306', 'DOM-03', 'Géothermie / Pompes à chaleur', 6),
('SPE-0307', 'DOM-03', 'Chauffage urbain / Réseaux de chaleur', 7),
('SPE-0308', 'DOM-03', 'Fluides industriels', 8),
('SPE-0399', 'DOM-03', 'Autre (champ texte libre)', 99),
-- DOM-04
('SPE-0401', 'DOM-04', 'Électricité générale (courants forts)', 1),
('SPE-0402', 'DOM-04', 'Courants faibles (réseaux, détection, contrôle d''accès)', 2),
('SPE-0403', 'DOM-04', 'SSI (Système de sécurité incendie)', 3),
('SPE-0404', 'DOM-04', 'Éclairage public', 4),
('SPE-0405', 'DOM-04', 'Photovoltaïque / ENR', 5),
('SPE-0406', 'DOM-04', 'Groupes électrogènes', 6),
('SPE-0407', 'DOM-04', 'GTB-GTC (gestion technique du bâtiment)', 7),
('SPE-0408', 'DOM-04', 'Domotique / Smart building', 8),
('SPE-0409', 'DOM-04', 'IRVE (bornes de recharge)', 9),
('SPE-0499', 'DOM-04', 'Autre (champ texte libre)', 99),
-- DOM-05
('SPE-0501', 'DOM-05', 'Terrassement / Nivellement', 1),
('SPE-0502', 'DOM-05', 'Voirie / Enrobés', 2),
('SPE-0503', 'DOM-05', 'Réseaux enterrés (EU, EP, AEP)', 3),
('SPE-0504', 'DOM-05', 'Assainissement', 4),
('SPE-0505', 'DOM-05', 'Adduction d''eau potable', 5),
('SPE-0506', 'DOM-05', 'Génie civil ouvrages d''art', 6),
('SPE-0507', 'DOM-05', 'Signalisation routière', 7),
('SPE-0508', 'DOM-05', 'Éclairage extérieur', 8),
('SPE-0509', 'DOM-05', 'Mobilier urbain', 9),
('SPE-0599', 'DOM-05', 'Autre (champ texte libre)', 99),
-- DOM-06
('SPE-0601', 'DOM-06', 'Démolition / Curage', 1),
('SPE-0602', 'DOM-06', 'Désamiantage / Déplombage', 2),
('SPE-0603', 'DOM-06', 'Dépollution des sols', 3),
('SPE-0604', 'DOM-06', 'Déconstruction sélective', 4),
('SPE-0699', 'DOM-06', 'Autre (champ texte libre)', 99),
-- DOM-07
('SPE-0701', 'DOM-07', 'Création d''espaces verts', 1),
('SPE-0702', 'DOM-07', 'Entretien d''espaces verts', 2),
('SPE-0703', 'DOM-07', 'Arboriculture / Élagage', 3),
('SPE-0704', 'DOM-07', 'Arrosage automatique', 4),
('SPE-0705', 'DOM-07', 'Aménagement paysager', 5),
('SPE-0706', 'DOM-07', 'Terrains de sport / Sols sportifs', 6),
('SPE-0799', 'DOM-07', 'Autre (champ texte libre)', 99),
-- DOM-08
('SPE-0801', 'DOM-08', 'Architecture (neuf)', 1),
('SPE-0802', 'DOM-08', 'Architecture (réhabilitation / patrimoine)', 2),
('SPE-0803', 'DOM-08', 'Architecture intérieure', 3),
('SPE-0804', 'DOM-08', 'Architecture bioclimatique', 4),
('SPE-0805', 'DOM-08', 'Architecture hospitalière', 5),
('SPE-0806', 'DOM-08', 'Architecture scolaire', 6),
('SPE-0807', 'DOM-08', 'Urbanisme / Aménagement', 7),
('SPE-0808', 'DOM-08', 'Paysagisme conception', 8),
('SPE-0809', 'DOM-08', 'Maîtrise d''œuvre complète', 9),
('SPE-0810', 'DOM-08', 'Scénographie', 10),
('SPE-0811', 'DOM-08', 'Programmation architecturale', 11),
('SPE-0899', 'DOM-08', 'Autre (champ texte libre)', 99),
-- DOM-09
('SPE-0901', 'DOM-09', 'BET Structure', 1),
('SPE-0902', 'DOM-09', 'BET Fluides / CVC', 2),
('SPE-0903', 'DOM-09', 'BET Électricité', 3),
('SPE-0904', 'DOM-09', 'BET VRD / Hydraulique', 4),
('SPE-0905', 'DOM-09', 'BET Acoustique', 5),
('SPE-0906', 'DOM-09', 'BET Thermique / Énergétique', 6),
('SPE-0907', 'DOM-09', 'BET Façades', 7),
('SPE-0908', 'DOM-09', 'Économie de la construction', 8),
('SPE-0909', 'DOM-09', 'OPC (Ordonnancement, pilotage, coordination)', 9),
('SPE-0910', 'DOM-09', 'Géotechnique / Études de sols', 10),
('SPE-0911', 'DOM-09', 'Topographie / Géomètre', 11),
('SPE-0912', 'DOM-09', 'Ingénierie environnementale', 12),
('SPE-0913', 'DOM-09', 'BIM Management', 13),
('SPE-0914', 'DOM-09', 'Contrôle technique construction', 14),
('SPE-0915', 'DOM-09', 'Coordination SPS', 15),
('SPE-0916', 'DOM-09', 'Diagnostics immobiliers (amiante, plomb, DPE, accessibilité)', 16),
('SPE-0917', 'DOM-09', 'Ingénierie de la déconstruction', 17),
('SPE-0918', 'DOM-09', 'Commissionnement', 18),
('SPE-0919', 'DOM-09', 'Simulation thermique dynamique', 19),
('SPE-0920', 'DOM-09', 'Modélisation BIM', 20),
('SPE-0921', 'DOM-09', 'Ingénierie incendie', 21),
('SPE-0999', 'DOM-09', 'Autre (champ texte libre)', 99),
-- DOM-10
('SPE-1001', 'DOM-10', 'Développement logiciel / Applications', 1),
('SPE-1002', 'DOM-10', 'Infogérance / Hébergement', 2),
('SPE-1003', 'DOM-10', 'Cybersécurité', 3),
('SPE-1004', 'DOM-10', 'Réseaux / Télécoms / Câblage', 4),
('SPE-1005', 'DOM-10', 'Intégration de systèmes', 5),
('SPE-1006', 'DOM-10', 'Data / BI / Intelligence artificielle', 6),
('SPE-1007', 'DOM-10', 'GED / Dématérialisation', 7),
('SPE-1008', 'DOM-10', 'Maintenance informatique', 8),
('SPE-1009', 'DOM-10', 'Conseil IT / AMOA', 9),
('SPE-1010', 'DOM-10', 'Cloud / SaaS', 10),
('SPE-1011', 'DOM-10', 'Audiovisuel / Visioconférence', 11),
('SPE-1099', 'DOM-10', 'Autre (champ texte libre)', 99),
-- DOM-11
('SPE-1101', 'DOM-11', 'Assistance à maîtrise d''ouvrage (AMO)', 1),
('SPE-1102', 'DOM-11', 'Programmation (bâtiment / urbain)', 2),
('SPE-1103', 'DOM-11', 'Conseil en organisation / Management', 3),
('SPE-1104', 'DOM-11', 'Conseil en stratégie / Développement économique', 4),
('SPE-1105', 'DOM-11', 'Conseil RH / Recrutement', 5),
('SPE-1106', 'DOM-11', 'Conseil juridique / Marchés publics', 6),
('SPE-1107', 'DOM-11', 'Conseil en transition écologique / RSE', 7),
('SPE-1108', 'DOM-11', 'Conseil financier / Audit', 8),
('SPE-1109', 'DOM-11', 'Concertation / Participation citoyenne', 9),
('SPE-1110', 'DOM-11', 'Études socio-économiques', 10),
('SPE-1111', 'DOM-11', 'Évaluation de politiques publiques', 11),
('SPE-1199', 'DOM-11', 'Autre (champ texte libre)', 99),
-- DOM-12
('SPE-1201', 'DOM-12', 'Stratégie de communication', 1),
('SPE-1202', 'DOM-12', 'Communication digitale / Réseaux sociaux', 2),
('SPE-1203', 'DOM-12', 'Graphisme / Design', 3),
('SPE-1204', 'DOM-12', 'Impression / Reprographie', 4),
('SPE-1205', 'DOM-12', 'Signalétique', 5),
('SPE-1206', 'DOM-12', 'Événementiel / Scénographie', 6),
('SPE-1207', 'DOM-12', 'Audiovisuel / Production vidéo', 7),
('SPE-1208', 'DOM-12', 'Relations presse / RP', 8),
('SPE-1209', 'DOM-12', 'Rédaction / Contenus éditoriaux', 9),
('SPE-1210', 'DOM-12', 'Traduction / Interprétariat', 10),
('SPE-1299', 'DOM-12', 'Autre (champ texte libre)', 99),
-- DOM-13
('SPE-1301', 'DOM-13', 'Formation professionnelle continue', 1),
('SPE-1302', 'DOM-13', 'Insertion professionnelle', 2),
('SPE-1303', 'DOM-13', 'Formation numérique / Digital', 3),
('SPE-1304', 'DOM-13', 'Formation sécurité / Habilitations', 4),
('SPE-1305', 'DOM-13', 'Formation management / Soft skills', 5),
('SPE-1306', 'DOM-13', 'Formation langues', 6),
('SPE-1307', 'DOM-13', 'Ingénierie pédagogique', 7),
('SPE-1308', 'DOM-13', 'E-learning / Outils digitaux', 8),
('SPE-1399', 'DOM-13', 'Autre (champ texte libre)', 99),
-- DOM-14
('SPE-1401', 'DOM-14', 'Nettoyage de locaux', 1),
('SPE-1402', 'DOM-14', 'Nettoyage industriel', 2),
('SPE-1403', 'DOM-14', 'Nettoyage vitrerie', 3),
('SPE-1404', 'DOM-14', 'Hygiène 3D (dératisation, désinsectisation, désinfection)', 4),
('SPE-1405', 'DOM-14', 'Maintenance multitechnique', 5),
('SPE-1406', 'DOM-14', 'Maintenance CVC', 6),
('SPE-1407', 'DOM-14', 'Maintenance ascenseurs', 7),
('SPE-1408', 'DOM-14', 'Maintenance électrique', 8),
('SPE-1409', 'DOM-14', 'Maintenance espaces verts', 9),
('SPE-1410', 'DOM-14', 'Facility management', 10),
('SPE-1499', 'DOM-14', 'Autre (champ texte libre)', 99),
-- DOM-15
('SPE-1501', 'DOM-15', 'Gardiennage / Surveillance', 1),
('SPE-1502', 'DOM-15', 'Sécurité incendie (SSIAP)', 2),
('SPE-1503', 'DOM-15', 'Vidéosurveillance / Contrôle d''accès', 3),
('SPE-1504', 'DOM-15', 'Alarme / Détection intrusion', 4),
('SPE-1505', 'DOM-15', 'Sécurité événementielle', 5),
('SPE-1506', 'DOM-15', 'Télésurveillance', 6),
('SPE-1599', 'DOM-15', 'Autre (champ texte libre)', 99),
-- DOM-16
('SPE-1601', 'DOM-16', 'Transport de personnes', 1),
('SPE-1602', 'DOM-16', 'Transport de marchandises', 2),
('SPE-1603', 'DOM-16', 'Déménagement', 3),
('SPE-1604', 'DOM-16', 'Logistique / Entreposage', 4),
('SPE-1605', 'DOM-16', 'Transport scolaire', 5),
('SPE-1606', 'DOM-16', 'Transport sanitaire', 6),
('SPE-1699', 'DOM-16', 'Autre (champ texte libre)', 99),
-- DOM-17
('SPE-1701', 'DOM-17', 'Mobilier de bureau', 1),
('SPE-1702', 'DOM-17', 'Mobilier scolaire / Collectivités', 2),
('SPE-1703', 'DOM-17', 'Matériel informatique / Bureautique', 3),
('SPE-1704', 'DOM-17', 'Équipements médicaux', 4),
('SPE-1705', 'DOM-17', 'Vêtements de travail / EPI', 5),
('SPE-1706', 'DOM-17', 'Fournitures de bureau', 6),
('SPE-1707', 'DOM-17', 'Équipements sportifs', 7),
('SPE-1708', 'DOM-17', 'Véhicules / Flotte automobile', 8),
('SPE-1709', 'DOM-17', 'Signalisation', 9),
('SPE-1710', 'DOM-17', 'Équipements de cuisine collective', 10),
('SPE-1799', 'DOM-17', 'Autre (champ texte libre)', 99),
-- DOM-18
('SPE-1801', 'DOM-18', 'Restauration collective', 1),
('SPE-1802', 'DOM-18', 'Traiteur / Événementiel', 2),
('SPE-1803', 'DOM-18', 'Fourniture de denrées alimentaires', 3),
('SPE-1804', 'DOM-18', 'Distributeurs automatiques', 4),
('SPE-1899', 'DOM-18', 'Autre (champ texte libre)', 99),
-- DOM-19
('SPE-1901', 'DOM-19', 'Collecte / Traitement des déchets', 1),
('SPE-1902', 'DOM-19', 'Recyclage / Valorisation', 2),
('SPE-1903', 'DOM-19', 'Exploitation de réseaux d''eau', 3),
('SPE-1904', 'DOM-19', 'Exploitation de stations d''épuration', 4),
('SPE-1905', 'DOM-19', 'Performance énergétique / CPE', 5),
('SPE-1906', 'DOM-19', 'Audit énergétique', 6),
('SPE-1907', 'DOM-19', 'ENR (solaire, éolien, biomasse)', 7),
('SPE-1908', 'DOM-19', 'Études d''impact environnemental', 8),
('SPE-1909', 'DOM-19', 'Biodiversité & écologie urbaine', 9),
('SPE-1910', 'DOM-19', 'AMO énergie / CPE', 10),
('SPE-1911', 'DOM-19', 'Commissionnement énergétique', 11),
('SPE-1912', 'DOM-19', 'Monitoring énergétique', 12),
('SPE-1999', 'DOM-19', 'Autre (champ texte libre)', 99),
-- DOM-20
('SPE-2001', 'DOM-20', 'Prestations de soins', 1),
('SPE-2002', 'DOM-20', 'Équipements médicaux (installation/maintenance)', 2),
('SPE-2003', 'DOM-20', 'Aide à domicile', 3),
('SPE-2004', 'DOM-20', 'Médiation sociale', 4),
('SPE-2005', 'DOM-20', 'Études sanitaires / Épidémiologie', 5),
('SPE-2099', 'DOM-20', 'Autre (champ texte libre)', 99)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, domain_id = EXCLUDED.domain_id;

-- 8. Seed Data: Expertise Tags
INSERT INTO ref_expertise_tags (id, thematic, label, display_order) VALUES
('TAG-ENV-01', 'environnement', 'Construction bioclimatique', 1),
('TAG-ENV-02', 'environnement', 'Conception passive / Passivhaus', 2),
('TAG-ENV-03', 'environnement', 'HQE / NF Habitat', 3),
('TAG-ENV-04', 'environnement', 'BREEAM', 4),
('TAG-ENV-05', 'environnement', 'LEED', 5),
('TAG-ENV-06', 'environnement', 'E+C- / RE2020 avancée', 6),
('TAG-ENV-07', 'environnement', 'Économie circulaire / Réemploi', 7),
('TAG-ENV-08', 'environnement', 'Biosourcés / Géosourcés', 8),
('TAG-ENV-09', 'environnement', 'Bilan carbone / ACV', 9),
('TAG-ENV-10', 'environnement', 'Biodiversité & écologie urbaine', 10),
('TAG-ENV-11', 'environnement', 'Zéro artificialisation nette (ZAN)', 11),
('TAG-ENV-99', 'environnement', 'Autre (champ texte libre)', 99),
('TAG-CTX-01', 'contexte', 'Patrimoine classé / inscrit MH', 1),
('TAG-CTX-02', 'contexte', 'Patrimoine XXe siècle', 2),
('TAG-CTX-03', 'contexte', 'ERP (Établissements recevant du public)', 3),
('TAG-CTX-04', 'contexte', 'IGH (Immeubles de grande hauteur)', 4),
('TAG-CTX-05', 'contexte', 'Logement social', 5),
('TAG-CTX-06', 'contexte', 'Logement collectif privé', 6),
('TAG-CTX-07', 'contexte', 'Tertiaire / Bureaux', 7),
('TAG-CTX-08', 'contexte', 'Enseignement / Petite enfance', 8),
('TAG-CTX-09', 'contexte', 'Santé / Hospitalier', 9),
('TAG-CTX-10', 'contexte', 'Industriel / Logistique', 10),
('TAG-CTX-11', 'contexte', 'Commerce / Retail', 11),
('TAG-CTX-12', 'contexte', 'Hôtellerie / Restauration', 12),
('TAG-CTX-13', 'contexte', 'Infrastructures sportives', 13),
('TAG-CTX-14', 'contexte', 'Espaces publics / Places', 14),
('TAG-CTX-15', 'contexte', 'EHPAD / Médico-social', 15),
('TAG-CTX-16', 'contexte', 'Sites classés / AVAP / SPR', 16),
('TAG-CTX-17', 'contexte', 'Outre-mer / Tropical', 17),
('TAG-CTX-18', 'contexte', 'Sites SEVESO / ICPE', 18),
('TAG-CTX-19', 'contexte', 'Milieu occupé', 19),
('TAG-CTX-99', 'contexte', 'Autre (champ texte libre)', 99),
('TAG-MET-01', 'methodologie', 'BIM (modélisation)', 1),
('TAG-MET-02', 'methodologie', 'BIM Management / Coordination', 2),
('TAG-MET-03', 'methodologie', 'Lean construction', 3),
('TAG-MET-04', 'methodologie', 'Conception-réalisation', 4),
('TAG-MET-05', 'methodologie', 'PPP / Concessions', 5),
('TAG-MET-06', 'methodologie', 'Marchés globaux de performance', 6),
('TAG-MET-07', 'methodologie', 'Programmation architecturale', 7),
('TAG-MET-08', 'methodologie', 'Concours de maîtrise d''œuvre', 8),
('TAG-MET-09', 'methodologie', 'Démarche participative / Co-conception', 9),
('TAG-MET-99', 'methodologie', 'Autre (champ texte libre)', 99),
('TAG-CER-01', 'certification', 'RGE', 1),
('TAG-CER-02', 'certification', 'Qualibat', 2),
('TAG-CER-03', 'certification', 'OPQIBI', 3),
('TAG-CER-04', 'certification', 'OPQTECC', 4),
('TAG-CER-05', 'certification', 'Architecte du patrimoine (DSA)', 5),
('TAG-CER-06', 'certification', 'ISO 9001', 6),
('TAG-CER-07', 'certification', 'ISO 14001', 7),
('TAG-CER-08', 'certification', 'ISO 45001', 8),
('TAG-CER-09', 'certification', 'Qualiopi', 9),
('TAG-CER-10', 'certification', 'MASE', 10),
('TAG-CER-11', 'certification', 'Qualipaysage', 11),
('TAG-CER-12', 'certification', 'EMAS', 12),
('TAG-CER-99', 'certification', 'Autre (champ texte libre)', 99)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, thematic = EXCLUDED.thematic;

-- 9. Seed Data: Geo Zones
INSERT INTO ref_geo_zones (id, label, zone_type, display_order) VALUES
('GEO-01', 'Île-de-France', 'metropole', 1),
('GEO-02', 'Auvergne-Rhône-Alpes', 'metropole', 2),
('GEO-03', 'Bourgogne-Franche-Comté', 'metropole', 3),
('GEO-04', 'Bretagne', 'metropole', 4),
('GEO-05', 'Centre-Val de Loire', 'metropole', 5),
('GEO-06', 'Corse', 'metropole', 6),
('GEO-07', 'Grand Est', 'metropole', 7),
('GEO-08', 'Hauts-de-France', 'metropole', 8),
('GEO-09', 'Normandie', 'metropole', 9),
('GEO-10', 'Nouvelle-Aquitaine', 'metropole', 10),
('GEO-11', 'Occitanie', 'metropole', 11),
('GEO-12', 'Pays de la Loire', 'metropole', 12),
('GEO-13', 'Provence-Alpes-Côte d''Azur', 'metropole', 13),
('GEO-14', 'Guadeloupe', 'domtom', 14),
('GEO-15', 'Martinique', 'domtom', 15),
('GEO-16', 'Guyane', 'domtom', 16),
('GEO-17', 'La Réunion', 'domtom', 17),
('GEO-18', 'Mayotte', 'domtom', 18),
('GEO-19', 'Saint-Pierre-et-Miquelon', 'domtom', 19),
('GEO-20', 'Saint-Barthélemy', 'domtom', 20),
('GEO-21', 'Saint-Martin', 'domtom', 21),
('GEO-22', 'Wallis-et-Futuna', 'domtom', 22),
('GEO-23', 'Polynésie française', 'domtom', 23),
('GEO-24', 'Nouvelle-Calédonie', 'domtom', 24),
('GEO-25', 'Terres australes et antarctiques françaises', 'domtom', 25)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, zone_type = EXCLUDED.zone_type;
