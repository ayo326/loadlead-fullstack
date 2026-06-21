---
connie-title: 'Architecture — Organizations, Roles & Onboarding Spec'
connie-publish: true
connie-page-id: '393264'
---

# LoadLead Feature Specification: Organizations, Roles & Onboarding

**Status:** Draft
**Last updated:** June 12, 2026

---

## 1. Overview

LoadLead supports two ways for users to join the platform: provisioned by an Admin, or self-signup as an independent business. Both paths resolve into the same underlying model, where every user belongs to an Organization and holds a Role within it. This keeps permissions, data ownership, and onboarding consistent regardless of how an account was created.

**Core principle:** every business entity on the platform is an Organization, even a solo owner-operator. A one-person trucking business is simply an Organization with one member who holds the Owner role. This eliminates the need for separate "individual" and "company" account types.

---

## 2. Core Entities

| Entity | Description |
|---|---|
| **User** | An individual login (email/password or SSO). A user has no permissions on their own; all permissions come from membership in an Organization. |
| **Organization** | A business entity: a carrier, shipper, receiver, or any combination. Owns all business data (equipment, loads, bookings, facilities). |
| **Membership** | The link between a User and an Organization, carrying a Role and a status (active or suspended). A user may belong to more than one Organization. |
| **Invitation** | A pending, email-based offer to join an Organization with a pre-assigned Role. Expires after 7 days if not accepted. |

### 2.1 Organization Capabilities

Organizations carry capability flags rather than a single exclusive type, because one business can play multiple parts (for example, a distributor that both ships and receives):

- **Carrier:** owns equipment, employs drivers, accepts and hauls loads
- **Shipper:** posts loads and defines pickup facility profiles
- **Receiver:** confirms deliveries and defines delivery facility profiles

An Organization may hold any combination of these flags.

---

## 3. Roles

### 3.1 Platform Level

| Role | Scope | Description |
|---|---|---|
| **Platform Admin** | Entire application | LoadLead staff. Can create, suspend, and configure any Organization; provision users into any Organization; set global defaults (e.g., default safety buffer, buffer bounds). |

Platform Admin is held in a separate registry from organization roles. A customer's internal "admin" never gains platform-level authority.

### 3.2 Organization Level

| Role | Typical Holder | Description |
|---|---|---|
| **Owner** | Business owner / owner-operator | Full control of the Organization: profile, capability flags, members, equipment, buffer settings (within platform bounds), billing. |
| **Org Admin** | Office manager / dispatcher lead | Same as Owner except cannot transfer ownership, delete the Organization, or configure the safety buffer. |
| **Dispatcher** | Carrier back office | Assigns drivers to equipment, accepts loads on behalf of the Organization, manages bookings. |
| **Driver** | Carrier employee or owner-operator | Views and accepts loads for assigned equipment, updates load status, confirms pickup. |
| **Shipper User** | Shipper staff | Posts loads, manages pickup facility profiles, tracks shipments. |
| **Receiver User** | Receiver staff | Views inbound loads, manages delivery facility profiles, confirms delivery. |

A solo owner-operator holds the Owner role and implicitly has all Driver capabilities within their own Organization.

---

## 4. Onboarding Flows

### 4.1 Flow A: Admin-Provisioned

1. Platform Admin creates the Organization and sets its capability flags.
2. Admin sends Invitations by email, each with a pre-assigned Role (Driver, Shipper User, Receiver User, etc.).
3. Invitee opens the invitation link and creates their login (or signs in if they already have one).
4. The pending Invitation converts into an active Membership. The user lands inside the Organization with the correct role and zero setup required on their part.

### 4.2 Flow B: Self-Signup

1. User signs up directly on LoadLead.
2. Onboarding asks: "What does your business do?" with carrier, shipper, and receiver as multi-select options.
3. The system creates a new Organization with the selected capability flags and a Membership giving the user the Owner role, in one atomic step.
4. The user completes the relevant setup for their capabilities (carrier: equipment and buffer; shipper/receiver: facility profiles).

If a self-signed-up Owner later grows (for example, an owner-operator hires a second driver), they invite new members using the same Invitation mechanism from Flow A, scoped to their own Organization. The two flows fully converge after onboarding.

### 4.3 Invitation Rules

- Invitations are tied to an email address, a target Organization, and a Role.
- If the invited email already has a LoadLead account, accepting attaches a new Membership to the existing user rather than creating a duplicate account. This natively supports multi-organization users, such as a driver who hauls for two carriers.
- Invitations expire after 7 days and can be revoked by anyone with Owner or Org Admin role before acceptance.
- Accepting an invitation never elevates a user's role in any other Organization.

---

## 5. Permissions Matrix

| Capability | Platform Admin | Owner | Org Admin | Dispatcher | Driver | Shipper User | Receiver User |
|---|---|---|---|---|---|---|---|
| Create / suspend any Organization | Yes | No | No | No | No | No | No |
| Edit own Organization profile & flags | Yes | Yes | Yes | No | No | No | No |
| Invite / remove members (own org) | Yes | Yes | Yes | No | No | No | No |
| Manage equipment & capacity profiles | Yes | Yes | Yes | Yes | View assigned | No | No |
| Configure safety buffer (within bounds) | Yes | Yes | No | No | No | No | No |
| Post loads | No | Yes* | Yes* | No | No | Yes | No |
| Accept / book loads | No | Yes** | Yes** | Yes** | Yes (assigned equipment) | No | No |
| Update in-transit load status | No | Yes** | Yes** | Yes** | Yes | No | No |
| Manage facility profiles (dock, forklift) | No | Yes | Yes | No | No | Yes (pickup) | Yes (delivery) |
| Confirm delivery | No | Yes | Yes | No | Yes | No | Yes |
| View audit logs (own org) | Yes (all orgs) | Yes | Yes | No | No | No | No |

\* Requires the Organization to hold the Shipper capability flag.
\** Requires the Organization to hold the Carrier capability flag.

Role permissions and capability flags combine: a role grants the action, the flag grants the domain. A Dispatcher in an organization without the Carrier flag cannot book loads, regardless of role.

### 5.1 Safety Buffer Authority

Only two roles can set or change the safety buffer:

1. **Platform Admin:** sets the global default buffer and the allowed bounds (5% to 25%), and may set or override the buffer for any Organization.
2. **Owner:** the truck owner-operator (owner of the business) may set the buffer for their own Organization's equipment, within the platform-defined bounds.

No other role (Org Admin, Dispatcher, Driver, Shipper User, Receiver User) can modify the buffer. All other roles see the effective buffer as **read-only**, displayed on the equipment and load-entry screens with the following message:

> "Your effective safety buffer is [X]%, set by your admin. This keeps your bookable weight at [Y] lbs, [X]% below your rated capacity."

Example for a 5,000 lb rated truck with a 10% buffer:

> "Your effective safety buffer is 10%, set by your admin. This keeps your bookable weight at 4,500 lbs, 10% below your rated capacity."

If the buffer was set by the Owner rather than a Platform Admin, the message reads "set by your owner" instead. Every buffer change remains subject to the audit logging requirement in Section 6.

---

## 6. Data Ownership & Isolation Rules

1. **Org-scoped by default:** All business data (equipment, loads, bookings, facility profiles, buffer settings) belongs to exactly one Organization. Members can only see and act on data within Organizations where they hold an active Membership.
2. **Marketplace exception:** Loads with status *Posted* are intentionally cross-organization: they are visible to members of any Organization with the Carrier flag, since matching requires it. Edit rights on a posted load remain locked to the posting Organization.
3. **Assignment scoping for drivers:** A Driver sees only the equipment they are assigned to and loads matched or booked against that equipment, not the Organization's entire fleet.
4. **Suspension:** Suspending a Membership immediately revokes access without deleting history. Suspending an Organization (Platform Admin only) freezes all members, hides its posted loads from the marketplace, and preserves in-flight bookings for manual resolution.
5. **Auditability:** Membership changes, role changes, invitations, suspensions, and buffer changes are all logged with actor, timestamp, old value, and new value.

---

## 7. Edge Cases

- **Owner-operator who also ships:** An Organization can hold both Carrier and Shipper flags. The same Owner can post their own loads and haul others, with the matching engine preventing an Organization from booking its own posted load unless explicitly allowed.
- **Driver working for two carriers:** Supported via multiple Memberships. The driver selects an active Organization context when accepting loads; capacity and assignment always evaluate within that context only.
- **Last Owner leaving:** An Organization must always have at least one Owner. Ownership must be transferred before the final Owner can be removed or downgraded.
- **Receiver-only participants:** A receiver who never posts or hauls still gets an Organization (Receiver flag only) so facility profiles, delivery confirmations, and notifications have a consistent home.
