import Email from '../models/Email.js';
import Account from '../models/Account.js';
import { validationResult } from 'express-validator';
import txtgen from 'txtgen';
import nodemailer from 'nodemailer';

export async function getAllEmails(request, response, next) {
  try {
    const { mailbox } = await Account.findOne({ _id: request.user })
      .select('mailbox')
      .populate('mailbox.inbox mailbox.outbox mailbox.drafts mailbox.trash');
    console.log('Emails found', mailbox);

    response.status(200).json({ message: 'Emails found', mailbox });
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}

export async function sendEmail(request, response, next) {
  try {
    // validate data types
    const validationErrors = validationResult(request);
    if (!validationErrors.isEmpty())
      return response.status(400).json({
        message: 'Invalid data, see response.data.errors for more information',
        errors: validationErrors.errors,
      });

    // construct outgoing email
    const newEmailOut = new Email({
      from: request.body.from,
      to: request.body.to,
      subject: request.body.subject,
      message: request.body.message,
    });
    // save outgoing email
    const savedEmailOut = await newEmailOut.save();
    console.log('Email sent', savedEmailOut);

    // generate a random reply email
    const newEmailIn = new Email({
      from: request.body.to,
      to: request.body.from,
      subject: 'Re: ' + request.body.subject,
      message: txtgen.paragraph(),
    });
    // save random reply email
    const savedEmailIn = await newEmailIn.save();
    console.log('Reply received', savedEmailIn);

    response
      .status(201)
      .json({ message: 'Email sent, reply received', sent: savedEmailOut, received: savedEmailIn });

    // get user and update it's email ID's (outbox)
    const foundAccount = await Account.findOne({ _id: request.user });
    foundAccount.mailbox.outbox.push(savedEmailOut._id);
    foundAccount.mailbox.inbox.push(savedEmailIn._id);
    await foundAccount.save();
  } catch (error) {
    console.log(error);
    response.status(500);
  }
}


export async function saveDraft(request, response, next) {
  try {
    let newDraft = new Email({
      from: request.body.from,
      to: request.body.to,
      subject: request.body.subject,
      message: request.body.message,
    });

    const savedDraft = await newDraft.save();
    console.log('Draft saved', savedDraft);

    response.status(201).json({ message: 'Draft saved', draft: savedDraft });

    const foundAccount = await Account.findOne({ _id: request.user });
    foundAccount.mailbox.drafts.push(savedDraft._id);
    await foundAccount.save();
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}

export const updateDraft = async (request, response, next) => {
  try {
    let foundDraft = await Email.findOne({ _id: request.params.id });
    if (!foundDraft)
      return response.status(404).json({ message: 'Email not found', id: request.params.id });

    foundDraft.to = request.body.to;
    foundDraft.subject = request.body.subject;
    foundDraft.message = request.body.message;

    const savedDraft = await foundDraft.save();
    console.log('Draft updated', savedDraft);

    response.status(200).json({ message: 'Draft updated', draft: savedDraft });
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
};

export async function moveToTrash(request, response, next) {
  try {
    const foundUser = await Account.findOne({ _id: request.user });

    let { inbox, outbox, drafts, trash } = foundUser.mailbox;
    let isEmailFound = false;

    if (!isEmailFound)
      for (let i = 0; i < inbox.length; i++) {
        if (inbox[i].equals(request.params.id)) {
          trash.push(inbox[i]);
          inbox.splice(i, 1);
          console.log('Moved from inbox to trash', request.params.id);
          isEmailFound = true;
          break;
        }
      }

    if (!isEmailFound)
      for (let i = 0; i < outbox.length; i++) {
        if (outbox[i].equals(request.params.id)) {
          trash.push(outbox[i]);
          outbox.splice(i, 1);
          console.log('Moved from outbox to trash', request.params.id);
          isEmailFound = true;
          break;
        }
      }

    if (!isEmailFound)
      for (let i = 0; i < drafts.length; i++) {
        if (drafts[i].equals(request.params.id)) {
          trash.push(drafts[i]);
          drafts.splice(i, 1);
          console.log('Moved from drafts to trash', request.params.id);
          isEmailFound = true;
          break;
        }
      }

    const savedUser = await foundUser.save();
    const { mailbox } = await Account.populate(
      savedUser,
      'mailbox.inbox mailbox.outbox mailbox.drafts mailbox.trash',
    );

    response.status(200).json({ message: 'Moved to trash', mailbox });
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}

export async function removeFromTrash(request, response, next) {
  try {
    const foundUser = await Account.findOne({ _id: request.user }).populate(
      'mailbox.inbox mailbox.outbox mailbox.drafts mailbox.trash',
    );

    const { inbox, outbox, drafts, trash } = foundUser.mailbox;
    for (let i = 0; i < trash.length; i++) {
      if (trash[i]._id.equals(request.params.id)) {
        if (trash[i].to === '' || trash[i].subject === '' || trash[i].message === '') {
          drafts.push(trash[i]._id);
          trash.splice(i, 1);
          console.log('Moved from trash to drafts', request.params.id);
        } else if (trash[i].from === foundUser.email) {
          outbox.push(trash[i]._id);
          trash.splice(i, 1);
          console.log('Moved from trash to outbox', request.params.id);
        } else {
          inbox.push(trash[i]._id);
          trash.splice(i, 1);
          console.log('Moved from trash to inbox', request.params.id);
        }
        break;
      }
    }

    const savedUser = await foundUser.save();
    const { mailbox } = await Account.populate(
      savedUser,
      'mailbox.inbox mailbox.outbox mailbox.drafts mailbox.trash',
    );

    response.status(200).json({ message: 'Removed from trash', mailbox });
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}

export async function toggleEmailProperty(request, response, next) {
  try {
    const foundEmail = await Email.findOne({ _id: request.params.id });
    if (!foundEmail)
      return response.status(404).json({ message: 'Email not found', id: request.params.id });

    switch (request.params.toggle) {
      case 'read':
        foundEmail.read = true;
        break;
      case 'unread':
        foundEmail.read = false;
        break;
      case 'favorite':
        foundEmail.favorite = true;
        break;
      case 'unfavorite':
        foundEmail.favorite = false;
        break;
      default:
        return response.status(404).json({ message: "Wrong params, can't parse request" });
    }

    const savedEmail = await foundEmail.save();
    console.log(`${request.params.toggle} status updated`, savedEmail);

    response
      .status(200)
      .json({ message: `${request.params.toggle} status updated`, email: savedEmail });
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}

export async function deleteEmail(request, response, next) {
  try {
    await Email.deleteOne({ _id: request.params.id });
    console.log('Email deleted', request.params.id);

    response.status(200).json({ message: 'Email deleted', id: request.params.id });

    const foundAccount = await Account.findOne({ _id: request.user });
    let isEmailFound = false;
    let trashbox = foundAccount.mailbox.trash;
    for (let i = 0; i < trashbox.length; i++) {
      if (trashbox[i].equals(request.params.id)) {
        trashbox.splice(i, 1);
        isEmailFound = true;
        break;
      }
    }
    if (!isEmailFound) {
      let drafts = foundAccount.mailbox.drafts;
      for (let i = 0; i < drafts.length; i++) {
        if (drafts[i].equals(request.params.id)) {
          drafts.splice(i, 1);
          break;
        }
      }
    }
    await foundAccount.save();
  } catch (error) {
    console.log(error);
    response.status(500).json({ message: 'Server error', error });
  }
}
