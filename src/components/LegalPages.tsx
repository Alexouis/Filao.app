import React from 'react';
import { APP_CONFIG } from '../config';

/**
 * Pages légales publiques : politique de confidentialité et conditions
 * d'utilisation.
 *
 * Ces pages doivent être accessibles SANS COMPTE : la console Google Cloud
 * exige des URL publiques pour configurer l'écran de consentement OAuth, et
 * l'article 13 du RGPD impose que l'information soit délivrée au moment de la
 * collecte — donc avant l'inscription.
 *
 * ⚠️ CONTENU À FAIRE RELIRE PAR UN AVOCAT avant exploitation commerciale.
 *    Le texte décrit fidèlement le fonctionnement réel de l'application
 *    (traitements, sous-traitants, durées), mais la rédaction juridique et
 *    l'adéquation aux obligations du secteur relèvent d'un conseil qualifié.
 *
 * Les éléments entre crochets [À COMPLÉTER] sont des informations d'entreprise
 * que seul l'éditeur détient.
 */

const DERNIERE_MAJ = '1er juillet 2026';

// --- Éléments de mise en page partagés ----------------------------------

const Page: React.FC<{ titre: string; children: React.ReactNode }> = ({ titre, children }) => (
    <div className="min-h-screen bg-white">
        <header className="border-b border-gray-100">
            <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between">
                <a href="/" className="flex items-center gap-3">
                    <img src={APP_CONFIG.altLogo} alt="FILAO" className="h-8" />
                </a>
                <a href="/" className="text-sm text-[#00A3E0] hover:underline">
                    Retour à l'application
                </a>
            </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-[#0B1F38] mb-2">{titre}</h1>
            <p className="text-sm text-gray-500 mb-10">
                Dernière mise à jour : {DERNIERE_MAJ}
            </p>
            <div className="space-y-8 text-[15px] leading-relaxed text-gray-700">
                {children}
            </div>
        </main>

        <footer className="border-t border-gray-100 mt-12">
            <div className="max-w-3xl mx-auto px-6 py-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
                <a href="/confidentialite" className="hover:text-[#00A3E0]">Politique de confidentialité</a>
                <a href="/cgu" className="hover:text-[#00A3E0]">Conditions d'utilisation</a>
                <a href="/" className="hover:text-[#00A3E0]">FILAO</a>
            </div>
        </footer>
    </div>
);

const Section: React.FC<{ titre: string; children: React.ReactNode }> = ({ titre, children }) => (
    <section className="space-y-3">
        <h2 className="text-xl font-bold text-[#0B1F38]">{titre}</h2>
        {children}
    </section>
);

const Encadre: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        {children}
    </div>
);

/**
 * Pied de page légal réutilisable.
 *
 * Le RGPD impose que l'information soit accessible au moment de la collecte :
 * ces liens doivent donc figurer sur les écrans de connexion et d'inscription,
 * pas uniquement dans l'application authentifiée.
 */
export const LegalFooter: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400 ${className}`}>
        <a href="/cgu" target="_blank" rel="noopener noreferrer" className="hover:text-[#00A3E0] hover:underline">
            Conditions d'utilisation
        </a>
        <span aria-hidden="true">·</span>
        <a href="/confidentialite" target="_blank" rel="noopener noreferrer" className="hover:text-[#00A3E0] hover:underline">
            Politique de confidentialité
        </a>
    </div>
);

// --- Politique de confidentialité ---------------------------------------

export const Confidentialite: React.FC = () => (
    <Page titre="Politique de confidentialité">
        <p>
            FILAO est un outil de préparation de réponses aux appels d'offres publics
            en groupement. Cette page décrit les données que nous traitons, pourquoi,
            combien de temps, et les droits dont vous disposez.
        </p>

        <Section titre="1. Responsable du traitement">
            <p>
                [À COMPLÉTER : dénomination sociale, forme juridique, adresse du siège,
                numéro RCS] — ci-après « FILAO ».
            </p>
            <p>
                Pour toute question relative à vos données :{' '}
                <strong>[À COMPLÉTER : adresse e-mail de contact]</strong>.
            </p>
        </Section>

        <Section titre="2. Données que nous traitons">
            <p>Selon votre usage du service, nous traitons :</p>
            <ul className="list-disc pl-5 space-y-1">
                <li>
                    <strong>Compte utilisateur</strong> : prénom, nom, adresse e-mail,
                    téléphone, photo de profil, fonction. L'adresse e-mail sert
                    d'identifiant de connexion.
                </li>
                <li>
                    <strong>Entreprise</strong> : raison sociale, SIRET, adresse,
                    effectif, forme juridique, domaines d'activité, zones
                    d'intervention, certifications déclarées.
                </li>
                <li>
                    <strong>Dossiers d'appel d'offres</strong> : intitulé, acheteur,
                    dates, montants estimés, composition du groupement, pièces
                    déposées, échanges internes au dossier.
                </li>
                <li>
                    <strong>Coffre-fort documentaire</strong> : les pièces
                    administratives que vous y déposez (Kbis, attestations, etc.).
                </li>
                <li>
                    <strong>Journal de connexions</strong> : date, adresse IP,
                    navigateur et système d'exploitation, méthode d'authentification.
                    Ce journal vous est destiné : il vous permet de repérer un accès
                    que vous ne reconnaissez pas.
                </li>
                <li>
                    <strong>Facturation</strong> : offre souscrite, historique de
                    paiement. Les coordonnées bancaires ne transitent jamais par nos
                    serveurs et sont traitées directement par notre prestataire de
                    paiement.
                </li>
                <li>
                    <strong>Mesure d'audience</strong> : événements d'usage
                    pseudonymisés (voir section 6).
                </li>
                <li>
                    <strong>Origine de l'inscription</strong> : paramètres de campagne
                    présents dans l'adresse lors de votre première visite.
                </li>
            </ul>
            <p>
                Nous ne traitons aucune donnée sensible au sens de l'article 9 du RGPD.
            </p>
        </Section>

        <Section titre="3. Pourquoi nous les traitons">
            <ul className="list-disc pl-5 space-y-1">
                <li>
                    <strong>Exécution du contrat</strong> : fourniture du service,
                    gestion de votre compte, collaboration au sein d'un groupement,
                    facturation.
                </li>
                <li>
                    <strong>Obligation légale</strong> : conservation des pièces
                    comptables.
                </li>
                <li>
                    <strong>Intérêt légitime</strong> : sécurité du service (journal de
                    connexions, détection d'accès anormaux), amélioration du produit
                    par la mesure d'audience, annuaire d'entreprises issu de données
                    publiques.
                </li>
                <li>
                    <strong>Consentement</strong> : envoi d'actualités et
                    d'informations commerciales. Ce consentement est <em>facultatif</em>,
                    donné activement depuis vos paramètres, et retirable à tout moment
                    sans conséquence sur le service.
                </li>
            </ul>
        </Section>

        <Section titre="4. Combien de temps nous les conservons">
            <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="text-left p-3 font-semibold text-[#0B1F38]">Donnée</th>
                            <th className="text-left p-3 font-semibold text-[#0B1F38]">Durée</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        <tr><td className="p-3">Compte et fiche entreprise</td><td className="p-3">Durée du contrat, puis 3 ans</td></tr>
                        <tr><td className="p-3">Pièces du coffre-fort</td><td className="p-3">Durée du contrat, suppression sur demande</td></tr>
                        <tr><td className="p-3">Dossiers et groupements</td><td className="p-3">10 ans (prescription en marchés publics)</td></tr>
                        <tr><td className="p-3">Journal d'envoi d'e-mails</td><td className="p-3">1 an</td></tr>
                        <tr><td className="p-3">Prospection commerciale</td><td className="p-3">Jusqu'au retrait du consentement</td></tr>
                        <tr><td className="p-3">Mesure d'audience</td><td className="p-3">13 mois</td></tr>
                        <tr><td className="p-3">Facturation</td><td className="p-3">10 ans</td></tr>
                    </tbody>
                </table>
            </div>
        </Section>

        <Section titre="5. Qui y a accès">
            <p>
                <strong>Au sein de FILAO</strong> : seules les personnes qui en ont
                besoin pour l'exploitation et le support.
            </p>
            <p>
                <strong>Entre utilisateurs</strong> : les membres d'un même groupement
                voient les informations du dossier partagé et l'identité des autres
                membres. Une entreprise qui n'a pas accepté une invitation n'accède à
                aucun contenu du dossier. Votre coffre-fort documentaire n'est jamais
                partagé automatiquement : vous choisissez les pièces que vous déposez
                sur un dossier.
            </p>
            <p>
                <strong>Sous-traitants</strong> — chacun encadré par un contrat
                conforme à l'article 28 du RGPD :
            </p>
            <ul className="list-disc pl-5 space-y-1">
                <li><strong>Supabase</strong> — hébergement de la base de données et des fichiers</li>
                <li><strong>Stripe</strong> — traitement des paiements</li>
                <li><strong>Brevo</strong> — envoi des e-mails transactionnels</li>
                <li><strong>Google</strong> — connexion par compte Google et synchronisation d'agenda, si vous l'activez</li>
                <li><strong>PostHog</strong> — mesure d'audience, hébergée dans l'Union européenne</li>
            </ul>
            <p>
                Nous ne vendons ni ne louons vos données. Aucune donnée n'est cédée à
                des fins publicitaires.
            </p>
        </Section>

        <Section titre="6. Mesure d'audience, sans cookie">
            <p>
                Nous mesurons l'usage du service pour comprendre où les utilisateurs
                rencontrent des difficultés. Cette mesure est conçue pour ne pas vous
                identifier :
            </p>
            <ul className="list-disc pl-5 space-y-1">
                <li>votre identifiant est remplacé par un pseudonyme obtenu par hachage ;</li>
                <li>aucun nom, adresse e-mail, SIRET, intitulé de dossier ni nom d'acheteur n'est transmis ;</li>
                <li>les adresses contenant un jeton d'invitation sont masquées avant tout envoi ;</li>
                <li>aucun cookie non essentiel n'est déposé — c'est pourquoi vous ne voyez pas de bandeau de consentement.</li>
            </ul>
        </Section>

        <Section titre="7. Connexion par compte Google">
            <p>
                Si vous choisissez de vous connecter avec Google, nous recevons votre
                adresse e-mail, votre nom et votre photo de profil. Nous ne recevons
                jamais votre mot de passe Google.
            </p>
            <p>
                Si vous activez la synchronisation d'agenda, vous autorisez FILAO à
                créer et lire des événements de votre calendrier Google, afin d'y
                reporter les échéances de vos dossiers. Cette autorisation est
                facultative et révocable à tout moment depuis les paramètres de
                sécurité de votre compte Google.
            </p>
        </Section>

        <Section titre="8. Annuaire d'entreprises issu de données publiques">
            <p>
                FILAO exploite des données publiques d'entreprises (base Sirene,
                avis de marchés publics) pour alimenter son annuaire de partenaires
                potentiels. Ces données ne proviennent pas de vous mais de sources
                ouvertes, conformément à l'article 14 du RGPD.
            </p>
            <p>
                Nous n'y stockons aucune donnée de dirigeant ni contact personnel, et
                nous excluons les établissements dont le statut de diffusion Sirene est
                partiel. Si votre entreprise y figure et que vous souhaitez son
                retrait, écrivez à <strong>[À COMPLÉTER : adresse e-mail de contact]</strong> :
                la demande est traitée sous 30 jours et l'exclusion est conservée lors
                des mises à jour ultérieures.
            </p>
        </Section>

        <Section titre="9. Vos droits">
            <p>
                Vous disposez d'un droit d'accès, de rectification, d'effacement, de
                limitation, d'opposition et de portabilité.
            </p>
            <ul className="list-disc pl-5 space-y-1">
                <li>
                    <strong>Accès et portabilité</strong> : depuis Paramètres →
                    Sécurité, le bouton « Exporter mes données » vous remet
                    immédiatement une copie de vos données dans un format réutilisable.
                </li>
                <li>
                    <strong>Rectification</strong> : vos informations sont modifiables
                    depuis votre profil et la fiche de votre entreprise.
                </li>
                <li>
                    <strong>Effacement</strong> : la suppression du compte est
                    accessible depuis Paramètres → Sécurité. Certaines données sont
                    conservées au-delà lorsqu'une obligation légale l'impose
                    (facturation) ou pour ne pas rompre les dossiers de vos
                    cotraitants.
                </li>
                <li>
                    <strong>Opposition à la prospection</strong> : désactivable à tout
                    moment depuis vos préférences de notification.
                </li>
            </ul>
            <p>
                Pour exercer ces droits : <strong>[À COMPLÉTER : adresse e-mail de contact]</strong>.
                Vous pouvez également introduire une réclamation auprès de la CNIL
                (www.cnil.fr).
            </p>
        </Section>

        <Section titre="10. Sécurité">
            <p>
                Les échanges sont chiffrés en transit. L'accès aux données est
                cloisonné par entreprise au niveau de la base : une entreprise ne peut
                pas accéder aux dossiers d'une autre. Vous pouvez activer une
                authentification à deux facteurs depuis vos paramètres de sécurité, et
                consulter le journal de vos connexions récentes.
            </p>
        </Section>

        <Section titre="11. Modifications">
            <p>
                Toute modification substantielle de cette politique vous sera signalée
                dans l'application avant son entrée en vigueur.
            </p>
        </Section>
    </Page>
);

// --- Conditions d'utilisation -------------------------------------------

export const ConditionsUtilisation: React.FC = () => (
    <Page titre="Conditions générales d'utilisation">
        <Encadre>
            <strong>À retenir.</strong> FILAO est un outil d'organisation. Nous ne
            sommes ni intermédiaire, ni conseil, ni garant : nous ne vérifions pas les
            informations déclarées par les entreprises, et nous ne garantissons aucun
            résultat sur vos candidatures.
        </Encadre>

        <Section titre="1. Objet">
            <p>
                FILAO est un service en ligne d'aide à la préparation de réponses aux
                appels d'offres publics, seul ou en groupement. Il permet d'organiser
                un dossier, d'inviter des partenaires, de rassembler les pièces
                administratives et de suivre les échéances.
            </p>
            <p>
                L'utilisation du service vaut acceptation des présentes conditions.
            </p>
        </Section>

        <Section titre="2. Éditeur">
            <p>
                [À COMPLÉTER : dénomination sociale, forme juridique, capital, adresse
                du siège, RCS, numéro de TVA intracommunautaire, directeur de la
                publication, hébergeur et ses coordonnées].
            </p>
        </Section>

        <Section titre="3. Compte">
            <p>
                La création d'un compte suppose des informations exactes et à jour.
                Vous êtes responsable de la confidentialité de vos identifiants et des
                actions effectuées depuis votre compte. L'activation de
                l'authentification à deux facteurs est recommandée.
            </p>
            <p>
                Un compte est personnel. Le partage d'identifiants entre plusieurs
                personnes n'est pas autorisé.
            </p>
        </Section>

        <Section titre="4. FILAO est un outil, pas un intermédiaire">
            <p className="font-semibold text-[#0B1F38]">
                Cette section délimite ce que le service fait et ne fait pas. Elle est
                essentielle.
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>
                    <strong>Aucune vérification des informations déclarées.</strong>{' '}
                    Les compétences, qualifications, certifications, attestations et
                    autres informations renseignées par les entreprises le sont sous
                    leur seule responsabilité. FILAO ne garantit ni leur exactitude, ni
                    leur validité, ni leur actualité. <em>La vérification des pièces et
                    des capacités des cotraitants incombe au mandataire du
                    groupement.</em>
                </li>
                <li>
                    <strong>Aucune garantie de résultat.</strong> FILAO ne garantit ni
                    l'obtention d'un marché, ni la recevabilité d'une candidature, ni
                    l'exhaustivité des pièces détectées comme nécessaires. La
                    responsabilité de la conformité du dossier déposé appartient au
                    candidat.
                </li>
                <li>
                    <strong>Les indicateurs sont des aides à la décision.</strong> Les
                    scores, « potentiel de succès », suggestions de partenaires et
                    recommandations affichés dans l'interface sont des estimations
                    indicatives. Ils ne constituent ni un conseil juridique, ni un
                    conseil en stratégie d'achat public, et ne doivent pas se
                    substituer à votre propre analyse.
                </li>
                <li>
                    <strong>Aucune implication dans les relations entre membres.</strong>{' '}
                    Les accords de groupement, la répartition des lots, les conditions
                    financières et l'exécution du marché relèvent exclusivement des
                    entreprises concernées. FILAO n'est pas partie à ces relations et
                    n'assume aucune responsabilité à leur égard, y compris en cas de
                    défaillance d'un cotraitant.
                </li>
            </ul>
            <p className="text-sm text-gray-600">
                Nous attirons votre attention sur le fait qu'en groupement conjoint à
                mandataire solidaire, le mandataire supplée à ses frais la défaillance
                d'un cotraitant (CCAG-Travaux 2021, article 3.5). Cette conséquence
                relève de votre relation contractuelle, indépendamment de l'usage de
                FILAO.
            </p>
        </Section>

        <Section titre="5. Vos engagements">
            <p>En utilisant FILAO, vous vous engagez à :</p>
            <ul className="list-disc pl-5 space-y-1">
                <li>ne déposer que des documents dont vous détenez les droits ;</li>
                <li>ne pas utiliser le service à des fins illicites ou pour porter atteinte aux droits d'un tiers ;</li>
                <li>ne pas tenter d'accéder à des données ne vous appartenant pas, ni de contourner les mesures de sécurité ;</li>
                <li>respecter la confidentialité des informations auxquelles votre participation à un groupement vous donne accès.</li>
            </ul>
        </Section>

        <Section titre="6. Disponibilité">
            <p>
                Nous mettons en œuvre les moyens raisonnables pour assurer la
                disponibilité du service, sans garantie d'accès ininterrompu. Des
                interruptions peuvent survenir pour maintenance ou pour une cause
                extérieure. Nous vous recommandons de ne pas attendre l'échéance d'un
                marché pour finaliser un dépôt.
            </p>
        </Section>

        <Section titre="7. Abonnement et paiement">
            <p>
                Le service propose une offre gratuite et des offres payantes dont les
                caractéristiques et tarifs sont présentés dans l'application. Les
                paiements sont traités par Stripe. Les abonnements sont sans engagement
                de durée sauf mention contraire, et résiliables depuis votre espace de
                facturation.
            </p>
            <p>[À COMPLÉTER : modalités de résiliation, remboursement, droit de rétractation applicable aux professionnels.]</p>
        </Section>

        <Section titre="8. Propriété">
            <p>
                Vous conservez l'entière propriété des contenus que vous déposez. Vous
                nous accordez uniquement les droits techniques nécessaires à leur
                hébergement et à leur affichage aux personnes que vous en autorisez
                l'accès.
            </p>
            <p>
                La plateforme, sa marque et ses composants demeurent la propriété de
                FILAO.
            </p>
        </Section>

        <Section titre="9. Responsabilité">
            <p>
                Sauf faute lourde ou intentionnelle, et dans les limites permises par
                la loi, la responsabilité de FILAO est limitée aux dommages directs et
                plafonnée au montant des sommes versées au titre des douze mois
                précédant le fait générateur. Sont notamment exclus la perte de chance
                de remporter un marché, le manque à gagner et le préjudice
                d'image.
            </p>
        </Section>

        <Section titre="10. Résiliation">
            <p>
                Vous pouvez supprimer votre compte à tout moment depuis vos paramètres.
                Nous pouvons suspendre un compte en cas de manquement grave aux
                présentes conditions, après information préalable sauf urgence.
            </p>
        </Section>

        <Section titre="11. Droit applicable">
            <p>
                Les présentes conditions sont régies par le droit français. À défaut de
                résolution amiable, le litige sera porté devant les juridictions
                compétentes. [À COMPLÉTER : clause attributive de compétence, médiation
                de la consommation le cas échéant.]
            </p>
        </Section>
    </Page>
);
