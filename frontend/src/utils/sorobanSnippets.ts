export interface SorobanSnippet {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}

export const SOROBAN_SNIPPETS: readonly SorobanSnippet[] = [
  {
    label: "contract",
    detail: "Soroban contract scaffold",
    documentation:
      "Creates a contract type and implementation with an editable public method.",
    insertText: [
      "#[contract]",
      "pub struct ${1:MyContract};",
      "",
      "#[contractimpl]",
      "impl $1 {",
      "\tpub fn ${2:hello}(env: Env${3:, name: Symbol}) -> Symbol {",
      "\t\t${4:name}",
      "\t}",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contractimpl",
    detail: "Soroban contract implementation",
    documentation: "Creates a #[contractimpl] block for a contract type.",
    insertText: [
      "#[contractimpl]",
      "impl ${1:MyContract} {",
      "\tpub fn ${2:hello}(env: Env) -> ${3:Symbol} {",
      "\t\t${4:Symbol::new(&env, \"hello\")}",
      "\t}",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contractfn",
    detail: "Public Soroban contract method",
    documentation:
      "Scaffolds an exported contract method with editable parameters and return type.",
    insertText: [
      "pub fn ${1:method_name}(env: Env${2:, caller: Address}) -> ${3:Result<(), ContractError>} {",
      "\t${4:Ok(())}",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contracterror",
    detail: "Soroban contract error enum",
    documentation:
      "Creates a contract error enum with stable, explicit u32 discriminants.",
    insertText: [
      "#[contracterror]",
      "#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]",
      "#[repr(u32)]",
      "pub enum ${1:ContractError} {",
      "\t${2:Unauthorized} = 1,",
      "\t${3:InvalidInput} = 2,",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contracttype",
    detail: "Soroban contract record schema",
    documentation:
      "Creates a serializable contract record. Add fields with contractfield.",
    insertText: [
      "#[contracttype]",
      "#[derive(Clone, Debug, Eq, PartialEq)]",
      "pub struct ${1:Record} {",
      "\tpub ${2:id}: ${3:u32},",
      "\tpub ${4:name}: String,",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contractkeys",
    detail: "Soroban storage key schema",
    documentation:
      "Creates a contracttype enum for instance or persistent storage keys.",
    insertText: [
      "#[contracttype]",
      "#[derive(Clone)]",
      "pub enum ${1:DataKey} {",
      "\t${2:Admin},",
      "\t${3:Record}(Address),",
      "}",
      "$0",
    ].join("\n"),
  },
  {
    label: "contractfield",
    detail: "Contract schema field",
    documentation: "Adds a public field to a #[contracttype] struct.",
    insertText: "pub ${1:field_name}: ${2:i128},$0",
  },
];