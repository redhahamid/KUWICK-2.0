// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/*
 * FINDING 3 OF THE SEPTEMBER UAT: the punch selfie in the owner's timesheet
 * could not be opened. The owner is shown a 28-pixel square, `object-fit:
 * cover`, and asked to satisfy themselves it is the right face — which cannot
 * be done at that size, on a crop.
 *
 * The same dead thumbnail carried claim receipts, leave attachments and the
 * employee's own copies in the portal, because all four use this component.
 * Fixing it here fixes it on all four.
 */
vi.mock('../../../core/api-client', () => ({
  fetchBlobUrl: vi.fn().mockResolvedValue('blob:selfie'),
}));

const { AuthImage } = await import('./AuthImage');

describe('an image kept behind the bearer token', () => {
  it('holds the row open while it loads, rather than collapsing it', () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    // Before the bytes arrive there is a box of the same size and the same
    // name, so the row does not jump when the image lands.
    expect(screen.getByLabelText('Hafiz Osman, punch selfie')).toBeTruthy();
  });

  it('is a button once it has loaded, so the keyboard reaches it too', async () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    const button = await screen.findByRole('button', { name: /open larger/i });
    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('img')?.getAttribute('src')).toBe('blob:selfie');
  });

  it('opens the whole image, and it is the same image', async () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    fireEvent.click(await screen.findByRole('button', { name: /open larger/i }));

    const dialog = screen.getByRole('dialog', { name: 'Hafiz Osman, punch selfie' });
    // Not a second fetch, and not a different file: the bytes already in hand.
    const large = dialog.querySelector('.hr-zoom__img');
    expect(large?.getAttribute('src')).toBe('blob:selfie');
  });

  it('closes on Escape, so the keyboard is never trapped behind it', async () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    fireEvent.click(await screen.findByRole('button', { name: /open larger/i }));
    expect(screen.queryByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from the Close button, which is the only control that says so', async () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    fireEvent.click(await screen.findByRole('button', { name: /open larger/i }));

    // Exactly one. The area around the image closes it too, but it is hidden
    // from the accessibility tree rather than announced as a second "Close".
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when the area around the image is pressed', async () => {
    render(<AuthImage path="/workforce/staff-files/f1" alt="Hafiz Osman, punch selfie" className="hr-proof" />);
    fireEvent.click(await screen.findByRole('button', { name: /open larger/i }));

    const scrim = screen.getByRole('dialog').querySelector('.hr-zoom__scrim');
    fireEvent.click(scrim as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
