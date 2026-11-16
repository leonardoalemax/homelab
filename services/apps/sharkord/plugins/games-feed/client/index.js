// a real browser bundle: no bare imports, nothing resolves them in a page.
// the host exposes its own React so hooks and context work against one copy
const React = window.__SHARKORD_REACT__;

const LinkButton = ({ props }) =>
  React.createElement(
    'a',
    {
      href: props.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      style: {
        display: 'inline-block',
        marginRight: '8px',
        marginTop: '6px',
        padding: '6px 14px',
        borderRadius: '6px',
        background: 'var(--accent, #5865f2)',
        color: '#fff',
        fontSize: '13px',
        fontWeight: 600,
        textDecoration: 'none'
      }
    },
    props.label || 'Abrir'
  );

export const components = {};

export const messageComponents = {
  linkButton: LinkButton
};
